import "dotenv/config";
import { Client } from "pg";

function floorToSeconds(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`SET timezone = 'UTC'`);

  const syncStart = new Date("2026-08-21T19:57:39.505Z");
  const syncEnd = new Date("2026-08-21T20:12:13.708Z");
  const flooredSyncStart = floorToSeconds(syncStart);

  console.log("Floored syncStart: " + flooredSyncStart.toISOString());
  console.log("Sync End:          " + syncEnd.toISOString());

  // 17 ACTIVE records with lastSeenAt < syncStart (stale but still ACTIVE)
  console.log("\n=== 17 ACTIVE records with lastSeenAt < syncStart (stale but still ACTIVE) ===\n");

  const res1 = await client.query(`
    SELECT "externalId" as external_id, "title", "lastSeenAt" as last_seen_at,
           "createdAt" as created_at, "updatedAt" as updated_at, "status"
    FROM "Job"
    WHERE "source" = 'MICRO1'
      AND "status" = 'ACTIVE'
      AND "lastSeenAt" IS NOT NULL
      AND "lastSeenAt" < $1
    ORDER BY "updatedAt" DESC
  `, [flooredSyncStart]);

  console.log("Count: " + res1.rows.length);
  for (const r of res1.rows) {
    const ls = r.last_seen_at ? new Date(r.last_seen_at).toISOString() : "NULL";
    console.log(
      "  extId: " + r.external_id +
        ", title: " + r.title +
        ", lastSeen: " + ls +
        ", created: " + new Date(r.created_at).toISOString() +
        ", updated: " + new Date(r.updated_at).toISOString(),
    );
  }

  // Updated distribution for stale-ACTIVE records
  console.log("\n=== updatedAt distribution for stale-but-ACTIVE records ===\n");
  const res2 = await client.query(`
    SELECT DATE_TRUNC('minute', "updatedAt") as updated_at, COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1'
      AND "status" = 'ACTIVE'
      AND "lastSeenAt" IS NOT NULL
      AND "lastSeenAt" < $1
    GROUP BY DATE_TRUNC('minute', "updatedAt")
    ORDER BY updated_at DESC
  `, [flooredSyncStart]);
  for (const r of res2.rows) {
    console.log("  " + r.updated_at.toISOString() + " -> " + Number(r.count) + " records");
  }

  // Records UPDATED after sync end (by status)
  console.log("\n=== Records UPDATED after sync end (by status) ===\n");
  const res3 = await client.query(`
    SELECT "status", COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "updatedAt" > $1
    GROUP BY "status"
    ORDER BY "status"
  `, [syncEnd]);
  for (const r of res3.rows) {
    console.log("  " + r.status + ": " + Number(r.count));
  }

  // ACTIVE records updated AFTER sync end, with old lastSeenAt
  console.log("\n=== ACTIVE records updated AFTER sync end, with old lastSeenAt (import re-activation) ===\n");
  const res4 = await client.query(`
    SELECT "externalId" as external_id, "title", "lastSeenAt" as last_seen_at,
           "updatedAt" as updated_at, "createdAt" as created_at
    FROM "Job"
    WHERE "source" = 'MICRO1'
      AND "status" = 'ACTIVE'
      AND "updatedAt" > $1
      AND "lastSeenAt" IS NOT NULL
      AND "lastSeenAt" < $2
    ORDER BY "updatedAt" DESC
  `, [syncEnd, flooredSyncStart]);
  console.log("Count: " + res4.rows.length);
  for (const r of res4.rows) {
    console.log(
      "  extId: " + r.external_id +
        ", title: " + r.title +
        ", lastSeen: " + new Date(r.last_seen_at).toISOString() +
        ", created: " + new Date(r.created_at).toISOString() +
        ", updated: " + new Date(r.updated_at).toISOString(),
    );
  }

  // ACTIVE records with NULL lastSeenAt updated AFTER sync end
  console.log("\n=== ACTIVE records with NULL lastSeenAt updated AFTER sync end (import-created) ===\n");
  const res5 = await client.query(`
    SELECT "externalId" as external_id, "title", "createdAt" as created_at, "updatedAt" as updated_at
    FROM "Job"
    WHERE "source" = 'MICRO1'
      AND "status" = 'ACTIVE'
      AND "lastSeenAt" IS NULL
      AND "updatedAt" > $1
    ORDER BY "updatedAt" DESC
  `, [syncEnd]);
  console.log("Count: " + res5.rows.length);
  for (const r of res5.rows) {
    console.log(
      "  extId: " + r.external_id +
        ", title: " + r.title +
        ", created: " + new Date(r.created_at).toISOString() +
        ", updated: " + new Date(r.updated_at).toISOString(),
    );
  }

  // Summary of stale-ACTIVE records
  console.log("\n=== Summary of the 17 stale-ACTIVE records ===\n");

  const res6 = await client.query(`
    SELECT COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1'
      AND "status" = 'ACTIVE'
      AND "lastSeenAt" IS NOT NULL
      AND "lastSeenAt" < $1
      AND "updatedAt" > $2
  `, [flooredSyncStart, syncEnd]);
  console.log("Updated AFTER sync end (by import-micro1.ts): " + Number(res6.rows[0]?.count || 0));

  const res7 = await client.query(`
    SELECT COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1'
      AND "status" = 'ACTIVE'
      AND "lastSeenAt" IS NOT NULL
      AND "lastSeenAt" < $1
      AND "updatedAt" <= $2
  `, [flooredSyncStart, syncEnd]);
  console.log("Updated BEFORE/DURING sync (not touched by import): " + Number(res7.rows[0]?.count || 0));

  // Full breakdown of 375 ACTIVE
  console.log("\n=== Full breakdown of 375 ACTIVE records ===\n");

  // Count by lastSeenAt minute bucket
  const res8 = await client.query(`
    SELECT
      CASE
        WHEN "lastSeenAt" IS NULL THEN 'NULL (import-created)'
        WHEN "lastSeenAt" >= $1 THEN 'seen by last sync (354)'
        WHEN "lastSeenAt" < $1 AND "lastSeenAt" IS NOT NULL THEN 'seen by earlier sync (' || DATE_TRUNC('minute', "lastSeenAt")::text || ')'
      END as bucket,
      COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "status" = 'ACTIVE'
    GROUP BY bucket
    ORDER BY count DESC
  `, [flooredSyncStart]);
  for (const r of res8.rows) {
    console.log("  " + r.bucket + ": " + Number(r.count));
  }

  // Check: were any CLOSED records re-activated to ACTIVE by import?
  // Look for CLOSED records that were updated by import (lastSeenAt NULL) after being created by import
  console.log("\n=== CLOSED records with NULL lastSeenAt: createdAt distribution ===\n");
  const res9 = await client.query(`
    SELECT DATE_TRUNC('hour', "createdAt") as created_hour, COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1'
      AND "status" = 'CLOSED'
      AND "lastSeenAt" IS NULL
    GROUP BY DATE_TRUNC('hour', "createdAt")
    ORDER BY created_hour DESC
  `);
  for (const r of res9.rows) {
    console.log("  " + r.created_hour.toISOString() + " -> " + Number(r.count) + " records");
  }

  // Check if import-micro1.ts set any records to CLOSED
  // (import has mapStatus which maps filled/closed/expired -> CLOSED)
  console.log("\n=== CLOSED records with NULL lastSeenAt: updatedAt distribution ===\n");
  const res10 = await client.query(`
    SELECT DATE_TRUNC('hour', "updatedAt") as updated_hour, COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1'
      AND "status" = 'CLOSED'
      AND "lastSeenAt" IS NULL
    GROUP BY DATE_TRUNC('hour', "updatedAt")
    ORDER BY updated_hour DESC
    LIMIT 15
  `);
  for (const r of res10.rows) {
    console.log("  " + r.updated_hour.toISOString() + " -> " + Number(r.count) + " records");
  }

  // Does Micro1 portal externalId contain URL params? (affects matching)
  console.log("\n=== ExternalId patterns ===\n");
  const extIdPatterns = await client.query(`
    SELECT
      CASE
        WHEN "externalId" LIKE '%?%' THEN 'with_query_params'
        WHEN "externalId" ~ '^[0-9a-f]{8}-' THEN 'uuid_format'
        ELSE 'other'
      END as pattern,
      COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1'
    GROUP BY pattern
    ORDER BY count DESC
  `);
  for (const r of extIdPatterns.rows) {
    console.log("  " + r.pattern + ": " + Number(r.count));
  }

  // How many of the 375 ACTIVE have externalIds with query params?
  const activeWithParams = await client.query(`
    SELECT COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1'
      AND "status" = 'ACTIVE'
      AND "externalId" LIKE '%?%'
  `);
  console.log("\nACTIVE with query-param externalIds: " + Number(activeWithParams.rows[0]?.count || 0));

  const activeNoParams = await client.query(`
    SELECT COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1'
      AND "status" = 'ACTIVE'
      AND "externalId" NOT LIKE '%?%'
  `);
  console.log("ACTIVE with non-param externalIds: " + Number(activeNoParams.rows[0]?.count || 0));

  // SourceSync record
  console.log("\n=== SourceSync record ===\n");
  const syncRes = await client.query(`
    SELECT * FROM "SourceSync" WHERE "source" = 'MICRO1'
  `);
  console.log(JSON.stringify(syncRes.rows[0], null, 2));

  await client.end();
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
