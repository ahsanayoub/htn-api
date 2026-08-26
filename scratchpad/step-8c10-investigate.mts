import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL || "";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("=== PART 4: Database Reconciliation ===\n");

  // A. ACTIVE count for MICRO1
  const activeMicro1 = await prisma.job.count({
    where: { source: "MICRO1", status: "ACTIVE" },
  });

  // B. CLOSED count for MICRO1
  const closedMicro1 = await prisma.job.count({
    where: { source: "MICRO1", status: "CLOSED" },
  });

  // C. IMPORTED count for MICRO1
  const importedMicro1 = await prisma.job.count({
    where: { source: "MICRO1", status: "IMPORTED" },
  });

  const totalMicro1 = await prisma.job.count({
    where: { source: "MICRO1" },
  });

  const otherMicro1 = totalMicro1 - activeMicro1 - closedMicro1 - importedMicro1;

  console.log("MICRO1 counts:");
  console.log("  ACTIVE   = " + activeMicro1);
  console.log("  CLOSED   = " + closedMicro1);
  console.log("  IMPORTED = " + importedMicro1);
  console.log("  OTHER    = " + otherMicro1);
  console.log("  TOTAL    = " + totalMicro1);

  console.log("\n=== PART 4: Overall DB counts ===\n");
  const activeAll = await prisma.job.count({ where: { status: "ACTIVE" } });
  const closedAll = await prisma.job.count({ where: { status: "CLOSED" } });
  const importedAll = await prisma.job.count({ where: { status: "IMPORTED" } });
  const totalAll = await prisma.job.count();
  console.log("ACTIVE   = " + activeAll);
  console.log("CLOSED   = " + closedAll);
  console.log("IMPORTED = " + importedAll);
  console.log("TOTAL    = " + totalAll);

  console.log("\n=== All sources x status ===\n");
  const sourceStatusCounts = await prisma.$queryRaw<
    Array<{ source: string; status: string; count: number }>
  >`SELECT "source", "status", COUNT(*) as count
    FROM "Job"
    GROUP BY "source", "status"
    ORDER BY "source", "status"`;
  for (const s of sourceStatusCounts) {
    console.log("  " + s.source + " / " + s.status + " = " + Number(s.count));
  }

  console.log("\n=== PART 5: Duplicates by externalId ===\n");

  // Unique Micro1 externalIds via raw SQL
  const uniqueResult = await prisma.$queryRaw<
    Array<{ unique_count: number }>
  >`SELECT COUNT(DISTINCT "externalId") as unique_count
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "externalId" IS NOT NULL`;

  const uniqueExternalIds = Number(uniqueResult[0]?.unique_count || 0);

  console.log("Unique Micro1 externalIds (non-null): " + uniqueExternalIds);
  console.log("Total Micro1 DB records:             " + totalMicro1);
  console.log("Number of duplicate externalIds:     " + (totalMicro1 - uniqueExternalIds));
  console.log("Number of duplicate records:         " + ((totalMicro1 - uniqueExternalIds) + (totalMicro1 - uniqueExternalIds - (totalMicro1 - uniqueExternalIds))));

  // Better: count actual duplicate records
  const dupRecordCount = await prisma.$queryRaw<
    Array<{ dup_record_count: number }>
  >`SELECT SUM(count - 1) as dup_record_count
    FROM (
      SELECT "externalId", COUNT(*) as count
      FROM "Job"
      WHERE "source" = 'MICRO1' AND "externalId" IS NOT NULL
      GROUP BY "externalId"
      HAVING COUNT(*) > 1
    ) subq`;
  const numDuplicateRecords = Number(dupRecordCount[0]?.dup_record_count || 0);

  const dupExternalIdCount = await prisma.$queryRaw<
    Array<{ dup_ext_id_count: number }>
  >`SELECT COUNT(*) as dup_ext_id_count
    FROM (
      SELECT "externalId"
      FROM "Job"
      WHERE "source" = 'MICRO1' AND "externalId" IS NOT NULL
      GROUP BY "externalId"
      HAVING COUNT(*) > 1
    ) subq`;
  const numDuplicateExternalIds = Number(dupExternalIdCount[0]?.dup_ext_id_count || 0);

  console.log("Number of duplicate externalIds (refined): " + numDuplicateExternalIds);
  console.log("Number of duplicate records (refined):    " + numDuplicateRecords);

  // Duplicate records by status
  const dupActive = await prisma.$queryRaw<
    Array<{ count: number }>
  >`SELECT COUNT(*) as count
    FROM "Job" j
    WHERE j."source" = 'MICRO1'
      AND j."externalId" IS NOT NULL
      AND j."status" = 'ACTIVE'
      AND EXISTS (
        SELECT 1 FROM "Job" j2
        WHERE j2."source" = 'MICRO1'
          AND j2."externalId" = j."externalId"
          AND j2."id" != j."id"
      )`;

  const dupClosed = await prisma.$queryRaw<
    Array<{ count: number }>
  >`SELECT COUNT(*) as count
    FROM "Job" j
    WHERE j."source" = 'MICRO1'
      AND j."externalId" IS NOT NULL
      AND j."status" = 'CLOSED'
      AND EXISTS (
        SELECT 1 FROM "Job" j2
        WHERE j2."source" = 'MICRO1'
          AND j2."externalId" = j."externalId"
          AND j2."id" != j."id"
      )`;

  const dupImported = await prisma.$queryRaw<
    Array<{ count: number }>
  >`SELECT COUNT(*) as count
    FROM "Job" j
    WHERE j."source" = 'MICRO1'
      AND j."externalId" IS NOT NULL
      AND j."status" = 'IMPORTED'
      AND EXISTS (
        SELECT 1 FROM "Job" j2
        WHERE j2."source" = 'MICRO1'
          AND j2."externalId" = j."externalId"
          AND j2."id" != j."id"
      )`;

  console.log("\nDuplicate records by status:");
  console.log("  ACTIVE duplicates:   " + Number(dupActive[0]?.count || 0));
  console.log("  CLOSED duplicates:   " + Number(dupClosed[0]?.count || 0));
  console.log("  IMPORTED duplicates: " + Number(dupImported[0]?.count || 0));

  console.log("\n=== PART 6: Timestamp analysis ===\n");

  const allBatches = await prisma.$queryRaw<
    Array<{ created_at: Date; count: number }>
  >`SELECT DATE_TRUNC('minute', "createdAt") as created_at, COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1'
    GROUP BY DATE_TRUNC('minute', "createdAt")
    ORDER BY count DESC
    LIMIT 30`;

  console.log("Largest import batches (by count):");
  for (const b of allBatches) {
    const isLarge = Number(b.count) >= 100;
    console.log(
      "  " + b.created_at.toISOString() + " -> " + Number(b.count) +
        (isLarge ? " *** LARGE BATCH ***" : "") + " records",
    );
  }

  const recentBatches = await prisma.$queryRaw<
    Array<{ created_at: Date; count: number }>
  >`SELECT DATE_TRUNC('minute', "createdAt") as created_at, COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1'
    GROUP BY DATE_TRUNC('minute', "createdAt")
    ORDER BY created_at DESC
    LIMIT 30`;

  console.log("\nAll import batches (by minute, recent first):");
  for (const b of recentBatches) {
    console.log("  " + b.created_at.toISOString() + " -> " + Number(b.count) + " records");
  }

  // Count by lastSeenAt NULL status
  const activeWithNullLastSeen = await prisma.job.count({
    where: {
      source: "MICRO1",
      status: "ACTIVE",
      lastSeenAt: null,
    },
  });
  console.log("\nACTIVE Micro1 records with NULL lastSeenAt: " + activeWithNullLastSeen);

  const activeWithLastSeen = await prisma.job.count({
    where: {
      source: "MICRO1",
      status: "ACTIVE",
      lastSeenAt: { not: null },
    },
  });
  console.log("ACTIVE Micro1 records with non-NULL lastSeenAt: " + activeWithLastSeen);

  const closedWithNullLastSeen = await prisma.job.count({
    where: {
      source: "MICRO1",
      status: "CLOSED",
      lastSeenAt: null,
    },
  });
  console.log("CLOSED Micro1 records with NULL lastSeenAt: " + closedWithNullLastSeen);

  const closedWithLastSeen = await prisma.job.count({
    where: {
      source: "MICRO1",
      status: "CLOSED",
      lastSeenAt: { not: null },
    },
  });
  console.log("CLOSED Micro1 records with non-NULL lastSeenAt: " + closedWithLastSeen);

  const importedWithNullLastSeen = await prisma.job.count({
    where: {
      source: "MICRO1",
      status: "IMPORTED",
      lastSeenAt: null,
    },
  });
  console.log("IMPORTED Micro1 records with NULL lastSeenAt: " + importedWithNullLastSeen);

  const importedWithLastSeen = await prisma.job.count({
    where: {
      source: "MICRO1",
      status: "IMPORTED",
      lastSeenAt: { not: null },
    },
  });
  console.log("IMPORTED Micro1 records with non-NULL lastSeenAt: " + importedWithLastSeen);

  const syncRecord = await prisma.sourceSync.findUnique({
    where: { source: "MICRO1" },
  });
  console.log("\nSourceSync record for MICRO1:");
  console.log(JSON.stringify(syncRecord, null, 2));

  console.log("\nDistinct statuses for MICRO1:");
  const statusCounts = await prisma.$queryRaw<
    Array<{ status: string; count: number }>
  >`SELECT "status", COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1'
    GROUP BY "status"
    ORDER BY "status"`;
  for (const s of statusCounts) {
    console.log("  " + s.status + ": " + Number(s.count));
  }

  // Top 10 duplicate groups
  const topDups = await prisma.$queryRaw<
    Array<{ external_id: string; count: number; statuses: string }>
  >`SELECT "externalId" as external_id, COUNT(*) as count, STRING_AGG("status", ',') as statuses
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "externalId" IS NOT NULL
    GROUP BY "externalId"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 10`;
  if (topDups.length > 0) {
    console.log("\nTop duplicate externalId groups:");
    for (const g of topDups) {
      console.log("  externalId=" + g.external_id + ", count=" + Number(g.count) + ", statuses=" + g.statuses);
    }
  }

  console.log("\n=== PART 6: Sample ACTIVE records (most recent 30 by createdAt) ===\n");
  const recentActive = await prisma.$queryRaw<
    Array<{
      id: string;
      external_id: string;
      status: string;
      created_at: Date;
      updated_at: Date;
      last_seen_at: Date | null;
      last_synced_at: Date | null;
    }>
  >`SELECT "id", "externalId" as external_id, "status", "createdAt" as created_at,
           "updatedAt" as updated_at, "lastSeenAt" as last_seen_at, "lastSyncedAt" as last_synced_at
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "status" = 'ACTIVE'
    ORDER BY "createdAt" DESC
    LIMIT 30`;
  for (const r of recentActive) {
    const ls = r.last_seen_at ? new Date(r.last_seen_at as unknown as string).toISOString() : "NULL";
    const lsync = r.last_synced_at ? new Date(r.last_synced_at as unknown as string).toISOString() : "NULL";
    console.log(
      "  extId: " + r.external_id +
        ", created: " + new Date(r.created_at as unknown as string).toISOString() +
        ", updated: " + new Date(r.updated_at as unknown as string).toISOString() +
        ", lastSeen: " + ls +
        ", lastSynced: " + lsync,
    );
  }

  console.log("\n=== PART 6: Sample CLOSED records (most recent 15 by updatedAt) ===\n");
  const recentClosed = await prisma.$queryRaw<
    Array<{
      id: string;
      external_id: string;
      created_at: Date;
      updated_at: Date;
      last_seen_at: Date | null;
      last_synced_at: Date | null;
    }>
  >`SELECT "id", "externalId" as external_id, "createdAt" as created_at,
           "updatedAt" as updated_at, "lastSeenAt" as last_seen_at, "lastSyncedAt" as last_synced_at
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "status" = 'CLOSED'
    ORDER BY "updatedAt" DESC
    LIMIT 15`;
  for (const r of recentClosed) {
    const ls = r.last_seen_at ? new Date(r.last_seen_at as unknown as string).toISOString() : "NULL";
    const lsync = r.last_synced_at ? new Date(r.last_synced_at as unknown as string).toISOString() : "NULL";
    console.log(
      "  extId: " + r.external_id +
        ", created: " + new Date(r.created_at as unknown as string).toISOString() +
        ", updated: " + new Date(r.updated_at as unknown as string).toISOString() +
        ", lastSeen: " + ls +
        ", lastSynced: " + lsync,
    );
  }

  console.log("\n=== PART 6: ACTIVE + NULL lastSeenAt batches ===\n");
  const activeNullBatches = await prisma.$queryRaw<
    Array<{ created_at: Date; count: number }>
  >`SELECT DATE_TRUNC('minute', "createdAt") as created_at, COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "status" = 'ACTIVE' AND "lastSeenAt" IS NULL
    GROUP BY DATE_TRUNC('minute', "createdAt")
    ORDER BY created_at DESC
    LIMIT 20`;
  console.log("ACTIVE + NULL lastSeenAt batches:");
  for (const b of activeNullBatches) {
    console.log("  " + b.created_at.toISOString() + " -> " + Number(b.count) + " records");
  }

  console.log("\n=== PART 6: All 375 ACTIVE records - full timestamp distribution ===\n");
  const activeTimestampDist = await prisma.$queryRaw<
    Array<{ created_at: Date; updated_at: Date; count: number }>
  >`SELECT DATE_TRUNC('minute', "createdAt") as created_at,
       DATE_TRUNC('minute', "updatedAt") as updated_at,
       COUNT(*) as count
    FROM "Job"
    WHERE "source" = 'MICRO1' AND "status" = 'ACTIVE'
    GROUP BY DATE_TRUNC('minute', "createdAt"), DATE_TRUNC('minute', "updatedAt")
    ORDER BY count DESC
    LIMIT 20`;
  for (const b of activeTimestampDist) {
    console.log(
      "  created=" + b.created_at.toISOString() +
        ", updated=" + b.updated_at.toISOString() +
        ", count=" + Number(b.count),
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
