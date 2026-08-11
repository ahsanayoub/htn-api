import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

dotenv.config({ override: true });

const connectionString = process.env.DATABASE_URL || "";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function run() {
  console.log('=== 1. Count jobs grouped by source ===');
  const bySource = await prisma.job.groupBy({
    by: ['source'],
    where: { source: { not: null } },
    _count: { _all: true },
  });
  console.log(JSON.stringify(bySource, null, 2));

  console.log('\n=== 2. Count jobs grouped by status ===');
  const byStatus = await prisma.job.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  console.log(JSON.stringify(byStatus, null, 2));

  console.log('\n=== 3. Count jobs grouped by source AND status ===');
  const bySourceStatus = await prisma.job.groupBy({
    by: ['source', 'status'],
    where: { source: { not: null } },
    _count: { _all: true },
  });
  console.log(JSON.stringify(bySourceStatus, null, 2));

  console.log('\n=== 4. Count jobs where externalId IS NULL ===');
  const nullExt = await prisma.job.count({ where: { externalId: null } });
  console.log('Jobs with NULL externalId:', nullExt);

  console.log('\n=== 5. Check for duplicate externalId values ===');
  const allExtIds = await prisma.job.findMany({
    where: { externalId: { not: null } },
    select: { externalId: true },
  });
  const extIdCounts = {};
  allExtIds.forEach(j => {
    const id = j.externalId;
    extIdCounts[id] = (extIdCounts[id] || 0) + 1;
  });
  const duplicates = Object.entries(extIdCounts).filter(([_, count]) => count > 1);
  console.log('Total jobs with externalId:', allExtIds.length);
  console.log('Duplicate externalIds found:', duplicates.length);
  console.log('Top 20 duplicates:', JSON.stringify(duplicates.slice(0, 20), null, 2));

  console.log('\n=== 6. Earliest and latest createdAt and postedAt values ===');
  const timeline = await prisma.$queryRaw`
    SELECT
      MIN("createdAt") as "earliestCreatedAt",
      MAX("createdAt") as "latestCreatedAt",
      MIN("postedAt") as "earliestPostedAt",
      MAX("postedAt") as "latestPostedAt"
    FROM "Job"
  `;
  console.log(JSON.stringify(timeline, null, 2));

  console.log('\n=== 7. Determine how Micro1 jobs are identified ===');
  const micro1Sample = await prisma.job.findFirst({
    where: { source: 'MICRO1' },
    select: { source: true, externalId: true, status: true, postedAt: true, createdAt: true },
  });
  console.log('Sample MICRO1 job:', JSON.stringify(micro1Sample, null, 2));

  console.log('\n=== 8. Total Micro1 jobs ===');
  const micro1Total = await prisma.job.count({ where: { source: 'MICRO1' } });
  console.log('Total MICRO1 jobs:', micro1Total);

  console.log('\n=== 9. Active vs inactive Micro1 jobs ===');
  const micro1ByStatus = await prisma.job.groupBy({
    by: ['status'],
    where: { source: 'MICRO1' },
    _count: { _all: true },
  });
  console.log(JSON.stringify(micro1ByStatus, null, 2));

  console.log('\n=== 10. Check if 438 jobs include other sources ===');
  const allSources = await prisma.job.groupBy({
    by: ['source'],
    _count: { _all: true },
  });
  console.log('All sources breakdown:', JSON.stringify(allSources, null, 2));

  console.log('\n=== Additional: Micro1 externalId format ===');
  const extIds = await prisma.job.findMany({
    where: { source: 'MICRO1', externalId: { not: null } },
    select: { externalId: true },
    take: 10,
  });
  console.log('Sample MICRO1 externalIds:', JSON.stringify(extIds, null, 2));

  await prisma.$disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
