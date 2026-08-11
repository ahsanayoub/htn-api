import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const syncStart = new Date("2026-08-10T17:17:04.831Z");

async function main() {
  // 1. Count jobs with lastSyncedAt = syncStart (successfully synced in this cycle)
  const synced = await prisma.job.count({
    where: { source: "MICRO1", lastSyncedAt: syncStart },
  });
  console.log("Jobs with lastSyncedAt = syncStart:", synced);

  // 2. Count jobs with lastSyncedAt = NULL
  const nullSync = await prisma.job.count({
    where: { source: "MICRO1", lastSyncedAt: null },
  });
  console.log("Jobs with lastSyncedAt = NULL:", nullSync);

  // 3. Count jobs with other lastSyncedAt
  const otherSync = await prisma.job.count({
    where: { source: "MICRO1", lastSyncedAt: { not: null, not: syncStart } },
  });
  console.log("Jobs with other lastSyncedAt:", otherSync);

  // 4. Total Micro1 jobs
  const total = await prisma.job.count({ where: { source: "MICRO1" } });
  console.log("Total Micro1 jobs:", total);

  // 5. Get externalIds of all 283 successfully synced jobs
  const syncedJobs = await prisma.job.findMany({
    where: { source: "MICRO1", lastSyncedAt: syncStart },
    select: { externalId: true, title: true },
  });
  const syncedExternalIds = new Set(syncedJobs.map(j => j.externalId));
  console.log("\nSample synced externalIds:", syncedJobs.slice(0, 3).map(j => j.externalId));

  // 6. Get all Micro1 jobs with NULL lastSyncedAt
  const nullSyncJobs = await prisma.job.findMany({
    where: { source: "MICRO1", lastSyncedAt: null },
    select: { externalId: true, title: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log("\nJobs with NULL lastSyncedAt:", nullSyncJobs.length);
  nullSyncJobs.forEach(j => {
    console.log(`  - externalId: ${j.externalId}, title: ${j.title}, createdAt: ${j.createdAt.toISOString()}, updatedAt: ${j.updatedAt.toISOString()}`);
  });

  // 7. Get externalIds of all synced jobs for cross-referencing
  const syncedExternalIdList = syncedJobs.map(j => j.externalId);
  console.log("\nTotal synced externalIds:", syncedExternalIdList.length);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
