import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL || "";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  // lastSeenAt distribution for ACTIVE records
  console.log("=== ACTIVE records: lastSeenAt minute distribution ===\n");
  const activeLastSeenDist = await prisma.$queryRaw<
    Array<{ last_seen_at: Date; count: number }>
  >`SELECT DATE_TRUNC('minute', "lastSeenAt") as last_seen_at, COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "status" = 'ACTIVE' AND "lastSeenAt" IS NOT NULL
    GROUP BY DATE_TRUNC('minute', "lastSeenAt")
    ORDER BY last_seen_at DESC
    LIMIT 30`;
  for (const b of activeLastSeenDist) {
    console.log(
      "  lastSeenAt=" + b.last_seen_at.toISOString() + " -> " + Number(b.count) + " ACTIVE records",
    );
  }

  // Active records with lastSeenAt = the last syncStart (2026-08-21T19:57:39 floored to 19:57:00)
  const syncStart = new Date("2026-08-21T19:57:39.505Z");
  const flooredSyncStart = new Date(Math.floor(syncStart.getTime() / 1000) * 1000);
  console.log(
    "\nLast syncStart (floored): " + flooredSyncStart.toISOString(),
  );

  const seenInLastSync = await prisma.job.count({
    where: {
      source: "MICRO1",
      status: "ACTIVE",
      lastSeenAt: { gte: flooredSyncStart },
    },
  });
  console.log(
    "ACTIVE records with lastSeenAt >= last syncStart: " + seenInLastSync,
  );

  const seenBeforeLastSync = await prisma.job.count({
    where: {
      source: "MICRO1",
      status: "ACTIVE",
      lastSeenAt: { lt: flooredSyncStart, not: null },
    },
  });
  console.log(
    "ACTIVE records with lastSeenAt < last syncStart (NOT NULL): " + seenBeforeLastSync,
  );

  const activeNullLastSeen = await prisma.job.count({
    where: {
      source: "MICRO1",
      status: "ACTIVE",
      lastSeenAt: null,
    },
  });
  console.log("ACTIVE records with NULL lastSeenAt: " + activeNullLastSeen);

  // Show the 4 ACTIVE records with NULL lastSeenAt
  console.log("\n=== The 4 ACTIVE records with NULL lastSeenAt (import-micro1.ts signature) ===\n");
  const nullLastSeenActive = await prisma.$queryRaw<
    Array<{
      id: string;
      external_id: string;
      title: string;
      created_at: Date;
      updated_at: Date;
      status: string;
    }>
  >`SELECT "id", "externalId" as external_id, "title", "createdAt" as created_at,
           "updatedAt" as updated_at, "status"
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "status" = 'ACTIVE' AND "lastSeenAt" IS NULL
    ORDER BY "createdAt" DESC`;
  for (const r of nullLastSeenActive) {
    console.log(
      "  extId: " + r.external_id +
        ", title: " + r.title +
        ", created: " + new Date(r.created_at as unknown as string).toISOString() +
        ", updated: " + new Date(r.updated_at as unknown as string).toISOString(),
    );
  }

  // Show the 10 IMPORTED records with NULL lastSeenAt
  console.log("\n=== The 10 IMPORTED records with NULL lastSeenAt ===\n");
  const nullLastSeenImported = await prisma.$queryRaw<
    Array<{
      external_id: string;
      title: string;
      created_at: Date;
      updated_at: Date;
    }>
  >`SELECT "externalId" as external_id, "title", "createdAt" as created_at,
           "updatedAt" as updated_at
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "status" = 'IMPORTED' AND "lastSeenAt" IS NULL
    ORDER BY "createdAt" DESC`;
  for (const r of nullLastSeenImported) {
    console.log(
      "  extId: " + r.external_id +
        ", title: " + r.title +
        ", created: " + new Date(r.created_at as unknown as string).toISOString() +
        ", updated: " + new Date(r.updated_at as unknown as string).toISOString(),
    );
  }

  // Check CLOSED records with NULL lastSeenAt (import-micro1.ts might have set them to CLOSED)
  console.log("\n=== CLOSED records with NULL lastSeenAt (import-micro1.ts signature) ===\n");
  const closedNullBatches = await prisma.$queryRaw<
    Array<{ created_at: Date; count: number }>
  >`SELECT DATE_TRUNC('minute', "createdAt") as created_at, COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "status" = 'CLOSED' AND "lastSeenAt" IS NULL
    GROUP BY DATE_TRUNC('minute', "createdAt")
    ORDER BY created_at DESC
    LIMIT 20`;
  for (const b of closedNullBatches) {
    console.log("  " + b.created_at.toISOString() + " -> " + Number(b.count) + " records");
  }

  // How many CLOSED records have NULL lastSeenAt
  const closedNullCount = await prisma.job.count({
    where: {
      source: "MICRO1",
      status: "CLOSED",
      lastSeenAt: null,
    },
  });
  console.log("\nTotal CLOSED with NULL lastSeenAt: " + closedNullCount);

  // Check if any CLOSED records were set by import-micro1.ts (i.e., have status CLOSED but no lastSeenAt, meaning import set them)
  console.log("\n=== Sample CLOSED records with NULL lastSeenAt (showing status mapping via import) ===");
  const sampleClosedNull = await prisma.$queryRaw<
    Array<{
      external_id: string;
      title: string;
      created_at: Date;
      updated_at: Date;
    }>
  >`SELECT "externalId" as external_id, "title", "createdAt" as created_at,
           "updatedAt" as updated_at
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "status" = 'CLOSED' AND "lastSeenAt" IS NULL
    ORDER BY "updatedAt" DESC
    LIMIT 15`;
  for (const r of sampleClosedNull) {
    console.log(
      "  extId: " + r.external_id +
        ", title: " + r.title +
        ", created: " + new Date(r.created_at as unknown as string).toISOString() +
        ", updated: " + new Date(r.updated_at as unknown as string).toISOString(),
    );
  }

  // Check records where updatedAt != createdAt (was updated by import-micro1.ts or sync)
  console.log("\n=== UPDATED ≠ CREATED (updated at least once) ===");
  const updatedDiff = await prisma.$queryRaw<
    Array<{ updated_at_min: Date; updated_at_max: Date; count: number }>
  >`SELECT MIN("updatedAt") as updated_at_min, MAX("updatedAt") as updated_at_max, COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "updatedAt" != "createdAt"`;
  for (const r of updatedDiff) {
    console.log(
      "  count=" + Number(r.count) +
        ", updated_range: " + new Date(r.updated_at_min as unknown as string).toISOString() +
        " to " + new Date(r.updated_at_max as unknown as string).toISOString(),
    );
  }

  // Show the import-micro1.ts signature: records where lastSeenAt is NULL but status is not the default
  // (import-micro1.ts sets status but not lastSeenAt)
  console.log("\n=== Records with NULL lastSeenAt by status (import-micro1.ts signature) ===");
  const nullLastSeenByStatus = await prisma.$queryRaw<
    Array<{ status: string; count: number }>
  >`SELECT "status", COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "lastSeenAt" IS NULL
    GROUP BY "status"
    ORDER BY "status"`;
  for (const r of nullLastSeenByStatus) {
    console.log("  " + r.status + ": " + Number(r.count));
  }

  // Show the import-micro1.ts signature: records where lastSeenAt is NOT NULL (sync-micro1.ts signature)
  console.log("\n=== Records with non-NULL lastSeenAt by status (sync-micro1.ts signature) ===");
  const nonNullLastSeenByStatus = await prisma.$queryRaw<
    Array<{ status: string; count: number }>
  >`SELECT "status", COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "lastSeenAt" IS NOT NULL
    GROUP BY "status"
    ORDER BY "status"`;
  for (const r of nonNullLastSeenByStatus) {
    console.log("  " + r.status + ": " + Number(r.count));
  }

  // Check all SourceSync records
  console.log("\n=== All SourceSync records ===");
  const allSyncs = await prisma.sourceSync.findMany({
    orderBy: { lastSyncAt: "desc" },
  });
  for (const s of allSyncs) {
    console.log(
      "  source=" + s.source +
        ", lastSyncAt=" + s.lastSyncAt?.toISOString() +
        ", lastSyncStart=" + s.lastSyncStart?.toISOString() +
        ", totalSeen=" + s.totalSeen +
        ", totalCreated=" + s.totalCreated +
        ", totalUpdated=" + s.totalUpdated +
        ", totalFailed=" + s.totalFailed,
    );
  }

  // Show all distinct createdAt minute batches for MICRO1, sorted by count
  console.log("\n=== All createdAt minute batches for MICRO1 ===");
  const allBatches = await prisma.$queryRaw<
    Array<{ created_at: Date; count: number }>
  >`SELECT DATE_TRUNC('minute', "createdAt") as created_at, COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1'
    GROUP BY DATE_TRUNC('minute', "createdAt")
    ORDER BY created_at DESC
    LIMIT 50`;
  for (const b of allBatches) {
    console.log("  " + b.created_at.toISOString() + " -> " + Number(b.count) + " records");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
