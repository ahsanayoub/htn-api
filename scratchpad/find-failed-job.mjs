import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const syncStart = new Date("2026-08-10T17:17:04.831Z");

// Count Micro1 jobs with lastSyncedAt = syncStart
const updated = await prisma.job.count({
  where: { source: "MICRO1", lastSyncedAt: syncStart },
});
console.log("Jobs with lastSyncedAt = syncStart:", updated);

// Count Micro1 jobs with lastSyncedAt = NULL
const nullSync = await prisma.job.count({
  where: { source: "MICRO1", lastSyncedAt: null },
});
console.log("Jobs with lastSyncedAt = NULL:", nullSync);

// Count Micro1 jobs with lastSyncedAt != syncStart and != NULL
const otherSync = await prisma.job.count({
  where: { source: "MICRO1", lastSyncedAt: { not: null, not: syncStart } },
});
console.log("Jobs with other lastSyncedAt:", otherSync);

// Total Micro1 jobs
const total = await prisma.job.count({ where: { source: "MICRO1" } });
console.log("Total Micro1 jobs:", total);

// Get all Micro1 jobs with lastSyncedAt = NULL (never synced)
const nullSyncJobs = await prisma.job.findMany({
  where: { source: "MICRO1", lastSyncedAt: null },
  select: { externalId: true, title: true, status: true, createdAt: true, updatedAt: true },
  orderBy: { createdAt: "desc" },
});
console.log("\nJobs with NULL lastSyncedAt:", nullSyncJobs.length);
nullSyncJobs.forEach((job) => {
  console.log(`  - externalId: ${job.externalId}, title: ${job.title}, status: ${job.status}, createdAt: ${job.createdAt.toISOString()}`);
});

await prisma.$disconnect();
