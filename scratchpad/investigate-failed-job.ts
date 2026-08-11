import "dotenv/config";
import prisma from "../src/prisma/client.js";

async function main() {
  // Find jobs with NULL lastSyncedAt (not synced in latest cycle)
  const unsyncedJobs = await prisma.job.findMany({
    where: {
      source: "MICRO1",
      lastSyncedAt: null,
    },
    select: {
      id: true,
      externalId: true,
      title: true,
      lastSeenAt: true,
      lastSyncedAt: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  console.log("Jobs with NULL lastSyncedAt:", unsyncedJobs.length);
  unsyncedJobs.forEach((job) => {
    console.log(JSON.stringify(job, null, 2));
  });

  // Find the most recent sync timestamp
  const latestSync = await prisma.job.findFirst({
    where: { source: "MICRO1", lastSyncedAt: { not: null } },
    select: { lastSyncedAt: true },
    orderBy: { lastSyncedAt: "desc" },
  });
  console.log("\nLatest sync timestamp:", latestSync?.lastSyncedAt);

  // Count jobs with lastSyncedAt set
  const syncedCount = await prisma.job.count({
    where: { source: "MICRO1", lastSyncedAt: { not: null } },
  });
  console.log("Jobs with lastSyncedAt set:", syncedCount);

  // Count jobs with lastSyncedAt NULL
  const unsyncedCount = await prisma.job.count({
    where: { source: "MICRO1", lastSyncedAt: null },
  });
  console.log("Jobs with lastSyncedAt NULL:", unsyncedCount);

  // Check SourceSync record
  const sourceSync = await prisma.sourceSync.findUnique({
    where: { source: "MICRO1" },
  });
  console.log("\nSourceSync record:", JSON.stringify(sourceSync, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
