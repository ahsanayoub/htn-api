import "dotenv/config";
import { Client } from "pg";
import { Micro1Client } from "../src/clients/micro1.client.js";

/* Use pg directly with UTC session to avoid Prisma timezone issues */
async function getDbJobs() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`SET timezone = 'UTC'`);

  const res = await client.query(`
    SELECT
      id, "externalId", title, status, "lastSeenAt", "updatedAt", "createdAt"
    FROM "Job"
    WHERE source = 'MICRO1'
    ORDER BY "updatedAt" DESC
  `);

  await client.end();
  return res.rows;
}

function extractUuidFromUrl(url: string): string | null {
  const match = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1].toLowerCase() : null;
}

function normalizeExternalId(id: string): string {
  return id.split("?")[0].trim().toLowerCase();
}

async function main() {
  process.stderr.write("\n[STEP 8C.9-v2] === Starting read-only reconciliation ===\n");

  /* Step 1: Fetch portal summaries */
  process.stderr.write("[STEP 8C.9-v2] Fetching portal summaries...\n");
  const micro1Client = new Micro1Client();
  const firstPage = await micro1Client.getJobs(1);

  if (!firstPage.data.length) {
    process.stderr.write("[STEP 8C.9-v2] No jobs returned from Micro1 portal.\n");
    return;
  }

  const totalJobs = firstPage.total;
  const pageSize = firstPage.data.length;
  const totalPages = Math.ceil(totalJobs / pageSize);
  process.stderr.write(`[STEP 8C.9-v2] Portal total=${totalJobs}, pages=${totalPages}\n`);

  const summaries = [...firstPage.data];
  for (let page = 2; page <= totalPages; page++) {
    const portal = await micro1Client.getJobs(page);
    summaries.push(...portal.data);
    process.stderr.write(`[STEP 8C.9-v2] Page ${page}/${totalPages}: ${portal.data.length}\r`);
  }

  /* Build portal externalId set from apply_url UUID extraction */
  const portalExternalIds: {
    job_id: string;
    apply_url: string;
    job_name: string;
    company_name: string;
    extractedUuid: string | null;
  }[] = summaries.map((s) => ({
    job_id: s.job_id,
    apply_url: s.apply_url,
    job_name: s.job_name,
    company_name: s.company_name,
    extractedUuid: extractUuidFromUrl(s.apply_url),
  }));

  process.stderr.write(`\n[STEP 8C.9-v2] --- STEP 1: Portal fetch ---\n`);
  process.stderr.write(`[STEP 8C.9-v2] Total job summaries returned: ${summaries.length}\n`);
  process.stderr.write(`[STEP 8C.9-v2] Unique job_ids: ${[...new Set(summaries.map((s) => s.job_id))].length}\n`);
  process.stderr.write(`[STEP 8C.9-v2] Unique apply_urls: ${[...new Set(summaries.map((s) => s.apply_url))].length}\n`);

  const idCounts: Record<string, number> = {};
  for (const s of summaries) {
    idCounts[s.job_id] = (idCounts[s.job_id] || 0) + 1;
  }
  const dupIds = Object.entries(idCounts).filter(([_, c]) => c > 1);
  process.stderr.write(`[STEP 8C.9-v2] Duplicate job_ids: ${dupIds.length}\n`);
  const urlCounts: Record<string, number> = {};
  for (const s of summaries) {
    urlCounts[s.apply_url] = (urlCounts[s.apply_url] || 0) + 1;
  }
  const dupUrls = Object.entries(urlCounts).filter(([_, c]) => c > 1);
  process.stderr.write(`[STEP 8C.9-v2] Duplicate apply_urls: ${dupUrls.length}\n`);

  process.stderr.write(`\n[STEP 8C.9-v2] Current portal externalId set:\n`);
  for (const p of portalExternalIds) {
    process.stderr.write(`  uuid=${p.extractedUuid} | job_id=${p.job_id} | title="${p.job_name}" | company="${p.company_name}"\n`);
  }

  /* Step 2: Database */
  process.stderr.write(`\n[STEP 8C.9-v2] --- STEP 2: Fetching database MICRO1 jobs ---`);
  const dbJobs = await getDbJobs();
  process.stderr.write(`[STEP 8C.9-v2] Total DB MICRO1 jobs: ${dbJobs.length}\n`);

  /* Build normalized DB externalId set */
  const dbExternalIdSet = new Set(dbJobs.map((j) => normalizeExternalId(j.externalId)));

  /* Step 3: Reconcile portal ↔ DB */
  const portalUuids = portalExternalIds.map((p) => p.extractedUuid).filter(Boolean) as string[];
  const portalUuidSet = new Set(portalUuids);

  // Find which DB jobs are on the portal
  const dbOnPortal = dbJobs.filter((j) => {
    const normExtId = normalizeExternalId(j.externalId);
    const dbUuid = extractUuidFromUrl(j.externalId);
    return portalUuidSet.has(normExtId) || (dbUuid !== null && portalUuidSet.has(dbUuid));
  });

  const dbNotOnPortal = dbJobs.filter((j) => {
    const normExtId = normalizeExternalId(j.externalId);
    const dbUuid = extractUuidFromUrl(j.externalId);
    return !portalUuidSet.has(normExtId) && (dbUuid === null || !portalUuidSet.has(dbUuid));
  });

  // Find portal jobs not in DB
  const portalNotInDb = portalExternalIds.filter((p) => {
    const uuid = p.extractedUuid;
    if (!uuid) return true;
    return !dbExternalIdSet.has(uuid);
  });

  process.stderr.write(`\n[STEP 8C.9-v2] --- STEP 3/4: Reconciliation ---\n`);
  process.stderr.write(`[STEP 8C.9-v2] DB jobs on portal: ${dbOnPortal.length}\n`);
  process.stderr.write(`[STEP 8C.9-v2] DB jobs NOT on portal: ${dbNotOnPortal.length}\n`);
  process.stderr.write(`[STEP 8C.9-v2] Portal jobs NOT in DB: ${portalNotInDb.length}\n`);
  process.stderr.write(`[STEP 8C.9-v2] Normalized matches (UUID): ${portalUuids.length}\n`);

  // Check for duplicate DB externalIds (same UUID, different externalId formats)
  const dbUuidMap: Record<string, { externalId: string; status: string; title: string }[]> = {};
  for (const j of dbJobs) {
    const uuid = extractUuidFromUrl(j.externalId);
    if (uuid) {
      if (!dbUuidMap[uuid]) dbUuidMap[uuid] = [];
      dbUuidMap[uuid].push({ externalId: j.externalId, status: j.status, title: j.title });
    }
  }
  const duplicateUuids = Object.entries(dbUuidMap).filter(([_, jobs]) => jobs.length > 1);
  process.stderr.write(`\n[STEP 8C.9-v2] DB externalIds with duplicate UUID: ${duplicateUuids.length}\n`);
  for (const [uuid, jobs] of duplicateUuids) {
    process.stderr.write(`  UUID=${uuid}:\n`);
    for (const j of jobs) {
      process.stderr.write(`    extId="${j.externalId}" status=${j.status} title="${j.title}"\n`);
    }
  }

  /* Step 5: 510 CLOSED jobs analysis */
  const closedJobs = dbJobs.filter((j) => j.status === "CLOSED");
  const closedWithNull = closedJobs.filter((j) => j.lastSeenAt === null);
  const closedWithEpoch = closedJobs.filter((j) => {
    const d = new Date(j.lastSeenAt);
    return d.getTime() === 0;
  });
  const closedWithPopulated = closedJobs.filter((j) => {
    if (j.lastSeenAt === null) return false;
    const d = new Date(j.lastSeenAt);
    return d.getTime() > 0;
  });

  const aug15Cluster = closedJobs.filter(
    (j) => j.lastSeenAt && new Date(j.lastSeenAt).toISOString().startsWith("2026-08-15T01:27:47"),
  );
  const aug10Cluster = closedJobs.filter(
    (j) => j.lastSeenAt && new Date(j.lastSeenAt).toISOString().startsWith("2026-08-10T22:17:04"),
  );
  const aug14Cluster = closedJobs.filter(
    (j) => j.lastSeenAt && new Date(j.lastSeenAt).toISOString().startsWith("2026-08-14T21:05:56"),
  );

  const closedOnPortal = closedJobs.filter((j) => {
    const normExtId = normalizeExternalId(j.externalId);
    const dbUuid = extractUuidFromUrl(j.externalId);
    return portalUuidSet.has(normExtId) || (dbUuid !== null && portalUuidSet.has(dbUuid));
  });

  process.stderr.write(`\n[STEP 8C.9-v2] --- STEP 5: 510 CLOSED jobs ---\n`);
  process.stderr.write(`[STEP 8C.9-v2] Total CLOSED: ${closedJobs.length}\n`);
  process.stderr.write(`[STEP 8C.9-v2] CLOSED with NULL lastSeenAt: ${closedWithNull.length}\n`);
  process.stderr.write(`[STEP 8C.9-v2] CLOSED with epoch lastSeenAt (1970): ${closedWithEpoch.length}\n`);
  process.stderr.write(`[STEP 8C.9-v2] CLOSED with populated lastSeenAt: ${closedWithPopulated.length}\n`);
  process.stderr.write(`[STEP 8C.9-v2] Aug 15 01:27:47 cluster: ${aug15Cluster.length}\n`);
  process.stderr.write(`[STEP 8C.9-v2] Aug 10 22:17:04 cluster: ${aug10Cluster.length}\n`);
  process.stderr.write(`[STEP 8C.9-v2] Aug 14 21:05:56 cluster: ${aug14Cluster.length}\n`);
  process.stderr.write(`[STEP 8C.9-v2] CLOSED on portal: ${closedOnPortal.length}\n`);
  process.stderr.write(`[STEP 8C.9-v2] CLOSED absent from portal: ${closedJobs.length - closedOnPortal.length}\n`);

  /* Step 6: 16 ACTIVE jobs */
  const activeJobs = dbJobs.filter((j) => j.status === "ACTIVE");
  process.stderr.write(`\n[STEP 8C.9-v2] --- STEP 6: ACTIVE jobs ---\n`);
  process.stderr.write(`[STEP 8C.9-v2] Total ACTIVE: ${activeJobs.length}\n`);

  let activeOnPortal = 0;
  let activeNotInPortal = 0;
  for (const job of activeJobs) {
    const normExtId = normalizeExternalId(job.externalId);
    const dbUuid = extractUuidFromUrl(job.externalId);
    const onPortal = portalUuidSet.has(normExtId) || (dbUuid !== null && portalUuidSet.has(dbUuid));
    if (onPortal) activeOnPortal++;
    else activeNotInPortal++;
    process.stderr.write(`  - "${job.title}" | extId="${job.externalId}" | lastSeenAt=${job.lastSeenAt} | status=${job.status} | onPortal=${onPortal}\n`);
  }
  process.stderr.write(`[STEP 8C.9-v2] ACTIVE on portal: ${activeOnPortal} | absent: ${activeNotInPortal}\n`);

  /* Step 7: IMPORTED jobs */
  const importedJobs = dbJobs.filter((j) => j.status === "IMPORTED");
  process.stderr.write(`\n[STEP 8C.9-v2] --- STEP 7: IMPORTED jobs ---\n`);
  process.stderr.write(`[STEP 8C.9-v2] Total IMPORTED: ${importedJobs.length}\n`);

  let importedOnPortal = 0;
  let importedNotInPortal = 0;
  for (const job of importedJobs) {
    const normExtId = normalizeExternalId(job.externalId);
    const dbUuid = extractUuidFromUrl(job.externalId);
    const onPortal = portalUuidSet.has(normExtId) || (dbUuid !== null && portalUuidSet.has(dbUuid));
    if (onPortal) importedOnPortal++;
    else importedNotInPortal++;
    process.stderr.write(`  - "${job.title}" | extId="${job.externalId}" | lastSeenAt=${job.lastSeenAt} | onPortal=${onPortal}\n`);
  }

  /* Portal jobs not in DB */
  process.stderr.write(`\n[STEP 8C.9-v2] --- Portal jobs NOT in DB ---\n`);
  for (const p of portalNotInDb) {
    process.stderr.write(`  - uuid="${p.extractedUuid}" job_id="${p.job_id}" title="${p.job_name}" | apply_url=${p.apply_url}\n`);
  }

  /* Step 8: Final table */
  process.stderr.write(`\n[STEP 8C.9-v2] --- STEP 8: Final reconciliation table ---\n`);
  process.stderr.write(`| Category | Count |\n`);
  process.stderr.write(`|---|---:|\n`);
  process.stderr.write(`| Current Micro1 jobs | ${summaries.length} |\n`);
  process.stderr.write(`| Current Micro1 + DB ACTIVE | ${activeOnPortal} |\n`);
  process.stderr.write(`| Current Micro1 + DB CLOSED | ${closedOnPortal.length} |\n`);
  process.stderr.write(`| Current Micro1 + DB IMPORTED | ${importedOnPortal} |\n`);
  process.stderr.write(`| Current Micro1 missing from DB | ${portalNotInDb.length} |\n`);
  process.stderr.write(`| DB ACTIVE absent from Micro1 | ${activeNotInPortal} |\n`);
  process.stderr.write(`| DB CLOSED absent from Micro1 | ${closedJobs.length - closedOnPortal.length} |\n`);
  process.stderr.write(`| DB IMPORTED absent from Micro1 | ${importedJobs.length - importedOnPortal} |\n`);

  // Reconcile: the sum of portal-matched DB jobs might exceed portal count
  // due to duplicate UUIDs (IMPORTED + CLOSED with same UUID)
  process.stderr.write(`\n[STEP 8C.9-v2] Note: DB matched on portal = ${dbOnPortal.length}, Portal total = ${summaries.length}`);
  process.stderr.write(`\n[STEP 8C.9-v2] DB not on portal = ${dbNotOnPortal.length}`);
  process.stderr.write(`\n[STEP 8C.9-v2] DB total = ${dbJobs.length} (matched + not-on-portal = ${dbOnPortal.length} + ${dbNotOnPortal.length} = ${dbOnPortal.length + dbNotOnPortal.length})`);

  /* Step 9: Confirm no changes */
  process.stderr.write(`\n[STEP 8C.9-v2] --- STEP 9: No changes ---\n`);
  process.stderr.write(`[STEP 8C.9-v2] Database writes: 0\n`);
  process.stderr.write(`[STEP 8C.9-v2] Job UPDATEs: 0\n`);
  process.stderr.write(`[STEP 8C.9-v2] Job DELETEs: 0\n`);
  process.stderr.write(`[STEP 8C.9-v2] Sync executed: NO\n`);
  process.stderr.write(`[STEP 8C.9-v2] Import executed: NO\n`);
  process.stderr.write(`[STEP 8C.9-v2] Source code modified: NO\n`);
  process.stderr.write(`[STEP 8C.9-v2] Commit: NO\n`);
  process.stderr.write(`[STEP 8C.9-v2] Push: NO\n`);
  process.stderr.write(`[STEP 8C.9-v2] Deployment: NO\n`);
  process.stderr.write(`\n[STEP 8C.9-v2] === Done ===\n`);
}

main().catch((err) => {
  process.stderr.write(`[STEP 8C.9-v2] Fatal error: ${err}\n`);
  process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
