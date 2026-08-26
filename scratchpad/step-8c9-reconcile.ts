import "dotenv/config";
import prisma from "../src/prisma/client.js";
import { Micro1Client } from "../src/clients/micro1.client.js";

/* Step 1: Fetch current Micro1 portal job summaries — same API path as production adapter */
async function fetchPortalSummaries() {
  const client = new Micro1Client();
  const firstPage = await client.getJobs(1);

  if (!firstPage.data.length) {
    return [];
  }

  const totalJobs = firstPage.total;
  const pageSize = firstPage.data.length;
  const totalPages = Math.ceil(totalJobs / pageSize);

  const all = [...firstPage.data];

  for (let page = 2; page <= totalPages; page++) {
    const portal = await client.getJobs(page);
    all.push(...portal.data);
    process.stderr.write(`[STEP 8C.9] Page ${page}/${totalPages}: ${portal.data.length} jobs\r`);
  }

  return all;
}

/* Step 2: Database MICRO1 set — read-only */
async function fetchDbJobs() {
  return await prisma.job.findMany({
    where: { source: "MICRO1" },
    select: {
      id: true,
      externalId: true,
      title: true,
      status: true,
      lastSeenAt: true,
      updatedAt: true,
      createdAt: true,
    },
  });
}

/* Extract UUID from an apply_url like https://micro1.ai/experts/{uuid}?utm_source=... */
function extractUuidFromUrl(url: string): string | null {
  // Match UUID pattern in the URL
  const match = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1].toLowerCase() : null;
}

function normalizeExternalId(id: string): string {
  return id.split("?")[0].trim().toLowerCase();
}

async function main() {
  process.stderr.write("\n[STEP 8C.9] === Starting read-only reconciliation ===\n");

  /* Step 1 */
  process.stderr.write("[STEP 8C.9] Fetching portal summaries...\n");
  const summaries = await fetchPortalSummaries();
  process.stderr.write(`[STEP 8C.9] Total job summaries returned: ${summaries.length}\n`);

  const uniqueIds = [...new Set(summaries.map((s) => s.job_id))];
  const uniqueApplyUrls = [...new Set(summaries.map((s) => s.apply_url))];
  process.stderr.write(`[STEP 8C.9] Total unique job_ids: ${uniqueIds.length}\n`);
  process.stderr.write(`[STEP 8C.9] Total unique apply_urls: ${uniqueApplyUrls.length}\n`);

  // Check for duplicate job_ids
  const idCounts: Record<string, number> = {};
  for (const s of summaries) {
    idCounts[s.job_id] = (idCounts[s.job_id] || 0) + 1;
  }
  const dupIds = Object.entries(idCounts).filter(([_, c]) => c > 1);
  process.stderr.write(`[STEP 8C.9] Duplicate job_ids: ${dupIds.length}\n`);

  // Check for duplicate apply_urls
  const urlCounts: Record<string, number> = {};
  for (const s of summaries) {
    urlCounts[s.apply_url] = (urlCounts[s.apply_url] || 0) + 1;
  }
  const dupUrls = Object.entries(urlCounts).filter(([_, c]) => c > 1);
  process.stderr.write(`[STEP 8C.9] Duplicate apply_urls: ${dupUrls.length}\n`);

  process.stderr.write(`\n[STEP 8C.9] All portal summaries:\n`);
  for (const s of summaries) {
    process.stderr.write(`  job_id=${s.job_id} | apply_url=${s.apply_url} | title="${s.job_name}" | company="${s.company_name}"\n`);
  }

  /* Step 2 */
  process.stderr.write(`\n[STEP 8C.9] Fetching database MICRO1 jobs...\n`);
  const dbJobs = await fetchDbJobs();
  process.stderr.write(`[STEP 8C.9] Total DB MICRO1 jobs: ${dbJobs.length}\n`);

  /* Step 3: Exact external-ID reconciliation */
  const dbExternalIdSet = new Set(dbJobs.map((j) => normalizeExternalId(j.externalId)));

  // Build portal externalId set by extracting UUID from apply_url
  const portalUuids: { job_id: string; apply_url: string; job_name: string; company_name: string; extractedUuid: string | null }[] =
    summaries.map((s) => ({
      job_id: s.job_id,
      apply_url: s.apply_url,
      job_name: s.job_name,
      company_name: s.company_name,
      extractedUuid: extractUuidFromUrl(s.apply_url),
    }));

  // Check if job_id matches any DB externalId
  let jobIdMatches = 0;
  let applyUrlUuidMatches = 0;
  let applyUrlExactMatches = 0;
  const unmatchedPortal: typeof portalUuids = [];

  for (const p of portalUuids) {
    const normJobId = normalizeExternalId(p.job_id);
    const normUuid = p.extractedUuid;
    const normApplyUrl = normalizeExternalId(p.apply_url);

    if (dbExternalIdSet.has(normJobId)) {
      jobIdMatches++;
    }

    if (normUuid && dbExternalIdSet.has(normUuid)) {
      applyUrlUuidMatches++;
    }

    if (dbExternalIdSet.has(normApplyUrl)) {
      applyUrlExactMatches++;
    }

    // Check if any DB externalId matches via any method
    const matched =
      dbExternalIdSet.has(normJobId) ||
      (normUuid ? dbExternalIdSet.has(normUuid) : false) ||
      dbExternalIdSet.has(normApplyUrl);

    if (!matched) {
      unmatchedPortal.push(p);
    }
  }

  process.stderr.write(`\n[STEP 8C.9] --- STEP 3/4: External-ID reconciliation ---\n`);
  process.stderr.write(`[STEP 8C.9] job_id exact matches: ${jobIdMatches}\n`);
  process.stderr.write(`[STEP 8C.9] apply_url UUID matches: ${applyUrlUuidMatches}\n`);
  process.stderr.write(`[STEP 8C.9] apply_url exact matches: ${applyUrlExactMatches}\n`);
  process.stderr.write(`[STEP 8C.9] Unmatched portal jobs: ${unmatchedPortal.length}\n`);

  /* Now fetch individual job pages for unmatched portal jobs to get canonical externalId */
  if (unmatchedPortal.length > 0) {
    process.stderr.write(`\n[STEP 8C.9] Fetching individual job pages for ${unmatchedPortal.length} unmatched portal jobs...\n`);
    // Import the processor (but suppress its noisy logging)
    process.env.SUPPRESS_MICRO1_LOGS = "1";
    const { micro1Processor } = await import("../src/index.js");

    let matchedViaProcessor = 0;
    for (const p of unmatchedPortal) {
      try {
        const job = await micro1Processor.process(p.apply_url);
        const normExtId = normalizeExternalId(job.externalId);
        if (dbExternalIdSet.has(normExtId)) {
          matchedViaProcessor++;
          process.stderr.write(`  MATCH via processor: "${p.job_name}" externalId=${job.externalId}\n`);
        } else {
          process.stderr.write(`  NO MATCH: "${p.job_name}" externalId=${job.externalId} (apply_url=${p.apply_url})\n`);
        }
      } catch (err) {
        process.stderr.write(`  ERROR fetching: "${p.job_name}" apply_url=${p.apply_url}\n`);
      }
    }
    process.stderr.write(`[STEP 8C.9] Matched via processor: ${matchedViaProcessor}\n`);
  }

  /* Build the full portal externalId set (using whatever matching we can do) */
  const portalMatchedIds: string[] = [];
  const portalUnmatchedNames: string[] = [];

  for (const p of portalUuids) {
    const normJobId = normalizeExternalId(p.job_id);
    const normUuid = p.extractedUuid;
    const normApplyUrl = normalizeExternalId(p.apply_url);

    if (dbExternalIdSet.has(normJobId)) {
      portalMatchedIds.push(p.job_id);
    } else if (normUuid && dbExternalIdSet.has(normUuid)) {
      portalMatchedIds.push(normUuid);
    } else if (dbExternalIdSet.has(normApplyUrl)) {
      portalMatchedIds.push(normApplyUrl);
    } else {
      portalUnmatchedNames.push(p.job_name);
    }
  }

  const portalIdSet = new Set(portalMatchedIds);

  /* Step 5: 510 CLOSED jobs analysis */
  const closedJobs = dbJobs.filter((j) => j.status === "CLOSED");
  const closedWithPopulatedLastSeen = closedJobs.filter(
    (j) => j.lastSeenAt && j.lastSeenAt.getTime() > 0,
  );
  const closedWithEpochLastSeen = closedJobs.filter(
    (j) => j.lastSeenAt && j.lastSeenAt.getTime() === 0,
  );
  const closedWithNullLastSeen = closedJobs.filter(
    (j) => j.lastSeenAt === null,
  );

  const aug15Cluster = closedJobs.filter(
    (j) => j.lastSeenAt && j.lastSeenAt.toISOString().startsWith("2026-08-15T01:27:47"),
  );
  const aug10Cluster = closedJobs.filter(
    (j) => j.lastSeenAt && j.lastSeenAt.toISOString().startsWith("2026-08-10T22:17:04"),
  );
  const aug14Cluster = closedJobs.filter(
    (j) => j.lastSeenAt && j.lastSeenAt.toISOString().startsWith("2026-08-14T21:05:56"),
  );

  // How many CLOSED jobs are on the portal
  const closedOnPortal = closedJobs.filter((dbJob) =>
    portalIdSet.has(normalizeExternalId(dbJob.externalId)),
  );

  /* Step 6: 16 ACTIVE jobs */
  const activeJobs = dbJobs.filter((j) => j.status === "ACTIVE");

  /* Step 7: IMPORTED jobs */
  const importedJobs = dbJobs.filter((j) => j.status === "IMPORTED");

  /* Step 8: Reconciliation table */
  const activeOnPortal = activeJobs.filter((dbJob) =>
    portalIdSet.has(normalizeExternalId(dbJob.externalId)),
  );
  const activeNotInPortal = activeJobs.filter(
    (dbJob) => !portalIdSet.has(normalizeExternalId(dbJob.externalId)),
  );
  const importedOnPortal = importedJobs.filter((dbJob) =>
    portalIdSet.has(normalizeExternalId(dbJob.externalId)),
  );
  const importedNotInPortal = importedJobs.filter(
    (dbJob) => !portalIdSet.has(normalizeExternalId(dbJob.externalId)),
  );
  const dbClosedOnPortal = closedJobs.filter((dbJob) =>
    portalIdSet.has(normalizeExternalId(dbJob.externalId)),
  );
  const dbClosedNotInPortal = closedJobs.filter(
    (dbJob) => !portalIdSet.has(normalizeExternalId(dbJob.externalId)),
  );

  process.stderr.write(`\n[STEP 8C.9] --- STEP 5: 510 CLOSED jobs analysis ---\n`);
  process.stderr.write(`[STEP 8C.9] Total CLOSED: ${closedJobs.length}\n`);
  process.stderr.write(`[STEP 8C.9] CLOSED with populated lastSeenAt: ${closedWithPopulatedLastSeen.length}\n`);
  process.stderr.write(`[STEP 8C.9] CLOSED with epoch lastSeenAt (1970): ${closedWithEpochLastSeen.length}\n`);
  process.stderr.write(`[STEP 8C.9] CLOSED with NULL lastSeenAt: ${closedWithNullLastSeen.length}\n`);
  process.stderr.write(`[STEP 8C.9] Aug 15 01:27:47 cluster: ${aug15Cluster.length}\n`);
  process.stderr.write(`[STEP 8C.9] Aug 10 22:17:04 cluster: ${aug10Cluster.length}\n`);
  process.stderr.write(`[STEP 8C.9] Aug 14 21:05:56 cluster: ${aug14Cluster.length}\n`);
  process.stderr.write(`[STEP 8C.9] CLOSED currently on portal: ${closedOnPortal.length}\n`);
  process.stderr.write(`[STEP 8C.9] CLOSED currently absent from portal: ${closedJobs.length - closedOnPortal.length}\n`);

  process.stderr.write(`\n[STEP 8C.9] --- STEP 6: 16 ACTIVE jobs ---\n`);
  process.stderr.write(`[STEP 8C.9] Present on portal: ${activeOnPortal.length}\n`);
  process.stderr.write(`[STEP 8C.9] Absent from portal: ${activeNotInPortal.length}\n`);
  for (const job of activeJobs) {
    const onPortal = portalIdSet.has(normalizeExternalId(job.externalId));
    process.stderr.write(`  - "${job.title}" | extId="${job.externalId}" | lastSeenAt=${job.lastSeenAt} | onPortal=${onPortal}\n`);
  }

  process.stderr.write(`\n[STEP 8C.9] --- STEP 7: IMPORTED jobs ---\n`);
  process.stderr.write(`[STEP 8C.9] Total IMPORTED: ${importedJobs.length}\n`);
  for (const job of importedJobs) {
    const onPortal = portalIdSet.has(normalizeExternalId(job.externalId));
    process.stderr.write(`  - "${job.title}" | extId="${job.externalId}" | lastSeenAt=${job.lastSeenAt} | onPortal=${onPortal}\n`);
  }

  /* Step 8: Final reconciliation table */
  const totalPortal = summaries.length;
  const portalMissingFromDb = unmatchedPortal.length;

  process.stderr.write(`\n[STEP 8C.9] --- STEP 8: Final reconciliation table ---\n`);
  process.stderr.write(`| Category | Count |\n`);
  process.stderr.write(`|---|---:|\n`);
  process.stderr.write(`| Current Micro1 jobs | ${totalPortal} |\n`);
  process.stderr.write(`| Current Micro1 + DB ACTIVE | ${activeOnPortal.length} |\n`);
  process.stderr.write(`| Current Micro1 + DB CLOSED | ${dbClosedOnPortal.length} |\n`);
  process.stderr.write(`| Current Micro1 + DB IMPORTED | ${importedOnPortal.length} |\n`);
  process.stderr.write(`| Current Micro1 missing from DB | ${portalMissingFromDb} |\n`);
  process.stderr.write(`| DB ACTIVE absent from Micro1 | ${activeNotInPortal.length} |\n`);
  process.stderr.write(`| DB CLOSED absent from Micro1 | ${dbClosedNotInPortal.length} |\n`);
  process.stderr.write(`| DB IMPORTED absent from Micro1 | ${importedNotInPortal.length} |\n`);

  // Math check
  const portalSplitTotal = activeOnPortal.length + dbClosedOnPortal.length + importedOnPortal.length + portalMissingFromDb;
  process.stderr.write(`\n[STEP 8C.9] Reconciliation check: portal split ${activeOnPortal.length}+${dbClosedOnPortal.length}+${importedOnPortal.length}+${portalMissingFromDb} = ${portalSplitTotal} (should=${totalPortal})\n`);
  process.stderr.write(`[STEP 8C.9] DB total = ${dbJobs.length} (should=${activeOnPortal.length + activeNotInPortal.length + dbClosedOnPortal.length + dbClosedNotInPortal.length + importedOnPortal.length + importedNotInPortal.length})\n`);

  process.stderr.write(`\n[STEP 8C.9] === Done ===\n`);
}

main().catch((err) => {
  process.stderr.write(`[STEP 8C.9] Fatal error: ${err}\n`);
  process.exit(1);
});
