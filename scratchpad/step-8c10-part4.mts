import "dotenv/config";
import { Client } from "pg";
import { Micro1Client } from "../src/clients/micro1.client.js";

function extractUuidFromUrl(url: string): string | null {
  const match = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1].toLowerCase() : null;
}

function normalizeExternalId(id: string): string {
  return id.split("?")[0].trim().toLowerCase();
}

function fmtDate(d: any): string {
  if (d === null || d === undefined) return "NULL";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "INVALID";
  return date.toISOString();
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`SET timezone = 'UTC'`);

  // Step 1: Fetch current Micro1 portal
  process.stderr.write("[STEP 8C.10] Fetching current Micro1 portal...\n");
  const micro1Client = new Micro1Client();
  const firstPage = await micro1Client.getJobs(1);

  const totalJobs = firstPage.total;
  const pageSize = firstPage.data.length;
  const totalPages = Math.ceil(totalJobs / pageSize);

  process.stderr.write(`[STEP 8C.10] Portal total=${totalJobs}, pages=${totalPages}\n`);

  const allSummaries = [...firstPage.data];
  for (let page = 2; page <= totalPages; page++) {
    const portal = await micro1Client.getJobs(page);
    allSummaries.push(...portal.data);
  }

  process.stderr.write(`[STEP 8C.10] Total portal summaries: ${allSummaries.length}\n`);

  const portalUuids = new Set(
    allSummaries
      .map((s) => extractUuidFromUrl(s.apply_url))
      .filter(Boolean) as string[],
  );
  process.stderr.write(`[STEP 8C.10] Unique portal UUIDs: ${portalUuids.size}\n`);

  // Step 2: Fetch DB jobs (using camelCase column names)
  const dbRes = await client.query(`
    SELECT "id", "externalId", "title", "status", "lastSeenAt", "updatedAt", "createdAt"
    FROM "Job"
    WHERE "source" = 'MICRO1'
  `);
  const dbJobs = dbRes.rows;

  const classify = (job: any) => {
    const normExtId = normalizeExternalId(job.externalId);
    const uuidMatch = extractUuidFromUrl(job.externalId);
    return portalUuids.has(normExtId) || (uuidMatch !== null && portalUuids.has(uuidMatch));
  };

  const activeJobs = dbJobs.filter((j: any) => j.status === "ACTIVE");
  const closedJobs = dbJobs.filter((j: any) => j.status === "CLOSED");
  const importedJobs = dbJobs.filter((j: any) => j.status === "IMPORTED");

  console.log("\n=== PART 4: Current Database Reconciliation ===");
  console.log("\nA. ACTIVE   = " + activeJobs.length);
  console.log("B. CLOSED   = " + closedJobs.length);
  console.log("C. IMPORTED = " + importedJobs.length);

  const activeOnPortal = activeJobs.filter(classify);
  const activeAbsent = activeJobs.filter((j: any) => !classify(j));
  const closedOnPortal = closedJobs.filter(classify);
  const closedAbsent = closedJobs.filter((j: any) => !classify(j));
  const importedOnPortal = importedJobs.filter(classify);
  const importedAbsent = importedJobs.filter((j: any) => !classify(j));

  console.log("\n--- Cross-reference with current Micro1 portal (" + portalUuids.size + " jobs) ---");
  console.log("1. ACTIVE present on Micro1:    " + activeOnPortal.length);
  console.log("2. ACTIVE absent from Micro1:   " + activeAbsent.length);
  console.log("3. CLOSED present on Micro1:    " + closedOnPortal.length);
  console.log("4. CLOSED absent from Micro1:   " + closedAbsent.length);
  console.log("5. IMPORTED present on Micro1:  " + importedOnPortal.length);
  console.log("6. IMPORTED absent from Micro1: " + importedAbsent.length);

  // Active absent breakdown by lastSeenAt
  const absentNull = activeAbsent.filter((j: any) => j.lastSeenAt === null);
  const absentStale = activeAbsent.filter((j: any) => j.lastSeenAt !== null && new Date(j.lastSeenAt) < new Date("2026-08-22T00:57:00.000Z"));
  const absentRecent = activeAbsent.filter((j: any) => j.lastSeenAt !== null && new Date(j.lastSeenAt) >= new Date("2026-08-22T00:57:00.000Z"));

  console.log("\n=== ACTIVE absent from portal: breakdown by lastSeenAt ===");
  console.log("  NULL lastSeenAt (import-created): " + absentNull.length);
  console.log("  stale lastSeenAt (< last syncStart): " + absentStale.length);
  console.log("  recent lastSeenAt (>= last syncStart): " + absentRecent.length);
  console.log("  Total: " + (absentNull.length + absentStale.length + absentRecent.length));

  // Active on portal with stale lastSeenAt
  const staleActiveOnPortal = activeOnPortal.filter(
    (j: any) => j.lastSeenAt !== null && new Date(j.lastSeenAt) < new Date("2026-08-22T00:57:00.000Z"),
  );
  console.log("\n=== ACTIVE on portal with stale lastSeenAt (< last syncStart) ===");
  console.log("Count: " + staleActiveOnPortal.length);
  for (const j of staleActiveOnPortal) {
    console.log(
      "  extId: " + j.externalId +
        ", lastSeen: " + fmtDate(j.lastSeenAt) +
        ", updated: " + fmtDate(j.updatedAt) +
        ", created: " + fmtDate(j.createdAt),
    );
  }

  // Active with NULL lastSeenAt on portal
  const activeNullOnPortal = activeOnPortal.filter((j: any) => j.lastSeenAt === null);
  console.log("\n=== ACTIVE on portal with NULL lastSeenAt ===");
  console.log("Count: " + activeNullOnPortal.length);
  for (const j of activeNullOnPortal) {
    console.log(
      "  extId: " + j.externalId +
        ", title: \"" + j.title + "\"" +
        ", created: " + fmtDate(j.createdAt) +
        ", updated: " + fmtDate(j.updatedAt),
    );
  }

  // Active absent from portal - stale lastSeenAt (the 17 records re-activated by import)
  console.log("\n=== ACTIVE absent from portal with stale lastSeenAt (sample, first 25) ===");
  for (const j of absentStale.slice(0, 25)) {
    console.log(
      "  extId: " + j.externalId +
        ", title: \"" + j.title + "\"" +
        ", lastSeen: " + fmtDate(j.lastSeenAt) +
        ", updated: " + fmtDate(j.updatedAt) +
        ", created: " + fmtDate(j.createdAt),
    );
  }
  console.log("... (showing " + absentStale.length + " total stale-absent records, displayed " + Math.min(25, absentStale.length) + ")");

  // Active absent from portal - NULL lastSeenAt
  console.log("\n=== ACTIVE absent from portal with NULL lastSeenAt ===");
  for (const j of absentNull) {
    console.log(
      "  extId: " + j.externalId +
        ", title: \"" + j.title + "\"" +
        ", created: " + fmtDate(j.createdAt) +
        ", updated: " + fmtDate(j.updatedAt),
    );
  }

  // Active absent from portal - recent lastSeenAt (seen by last sync but not on portal now)
  console.log("\n=== ACTIVE absent from portal with recent lastSeenAt (>= last syncStart) (sample, first 25) ===");
  for (const j of absentRecent.slice(0, 25)) {
    console.log(
      "  extId: " + j.externalId +
        ", title: \"" + j.title + "\"" +
        ", lastSeen: " + fmtDate(j.lastSeenAt) +
        ", updated: " + fmtDate(j.updatedAt) +
        ", created: " + fmtDate(j.createdAt),
    );
  }
  console.log("... (showing " + absentRecent.length + " total recent-absent records, displayed " + Math.min(25, absentRecent.length) + ")");

  // Closed on portal
  console.log("\n=== CLOSED present on Micro1 portal ===");
  if (closedOnPortal.length > 0) {
    for (const j of closedOnPortal.slice(0, 20)) {
      console.log(
        "  extId: " + j.externalId +
          ", lastSeen: " + fmtDate(j.lastSeenAt) +
          ", updated: " + fmtDate(j.updatedAt) +
          ", created: " + fmtDate(j.createdAt),
      );
    }
  } else {
    console.log("  (none)");
  }

  // IMPORTED records
  console.log("\n=== IMPORTED records ===");
  for (const j of importedJobs) {
    console.log(
      "  extId: " + j.externalId +
        ", title: \"" + j.title + "\"" +
        ", lastSeen: " + fmtDate(j.lastSeenAt) +
        ", created: " + fmtDate(j.createdAt) +
        ", updated: " + fmtDate(j.updatedAt) +
        ", onPortal: " + classify(j),
    );
  }

  // Verify: total ACTIVE = onPortal + absent
  console.log("\n=== Verification ===");
  console.log("ACTIVE split: " + activeOnPortal.length + " on portal + " + activeAbsent.length + " absent = " + (activeOnPortal.length + activeAbsent.length));
  console.log("Expected: " + activeJobs.length);

  await client.end();
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
