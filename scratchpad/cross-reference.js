import "dotenv/config";
import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const client = axios.create({
  baseURL: "https://prod-api.micro1.ai/api/v1",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

async function getJobs(page, limit = 18) {
  const { data } = await client.post(
    "/job/portal",
    {
      action: "get_all_jobs",
      filters: {
        type: ["EXPERT"],
      },
    },
    {
      params: {
        page,
        limit,
        keyword: "",
      },
    }
  );
  return data;
}

const syncStart = new Date("2026-08-10T17:17:04.831Z");

async function main() {
  // 1. Get all 283 synced externalIds from the database
  const syncedJobs = await prisma.job.findMany({
    where: { source: "MICRO1", lastSyncedAt: syncStart },
    select: { externalId: true, title: true },
  });
  const syncedExternalIds = new Set(syncedJobs.map(j => j.externalId));
  console.log("Synced jobs in DB:", syncedJobs.length);
  console.log("Sample synced externalIds:", syncedJobs.slice(0, 3).map(j => j.externalId));

  // 2. Fetch all job summaries from the API
  console.log("\n=== Fetching all job summaries from API ===");
  const firstPage = await getJobs(1);
  const totalJobs = firstPage.total;
  const pageSize = firstPage.data.length;
  const totalPages = Math.ceil(totalJobs / pageSize);
  console.log(`Total: ${totalJobs}, PageSize: ${pageSize}, TotalPages: ${totalPages}`);

  const allSummaries = [...firstPage.data];
  for (let page = 2; page <= totalPages; page++) {
    const portal = await getJobs(page);
    allSummaries.push(...portal.data);
    console.log(`Page ${page}/${totalPages}: ${portal.data.length} jobs (total so far: ${allSummaries.length})`);
  }
  console.log("Total job summaries fetched:", allSummaries.length);

  // 3. Cross-reference: find which API job_id is NOT in the synced externalIds
  // The externalId in DB comes from client_job_id in HTML page
  // The job_id in API response might be different
  // Let's check if job_id matches externalId
  console.log("\n=== Cross-referencing API job_ids with DB externalIds ===");
  const apiJobIds = allSummaries.map(s => s.job_id);
  const matched = apiJobIds.filter(id => syncedExternalIds.has(id));
  const unmatched = apiJobIds.filter(id => !syncedExternalIds.has(id));
  console.log("API job_ids matching synced externalIds:", matched.length);
  console.log("API job_ids NOT matching synced externalIds:", unmatched.length);
  if (unmatched.length > 0) {
    console.log("Unmatched job_ids:", unmatched);
  }

  // 4. Also check with utm-stripped externalIds
  console.log("\n=== Checking with stripped externalIds ===");
  const syncedExternalIdsStripped = new Set(
    syncedJobs.map(j => j.externalId.replace(/\?utm_.*$/, ""))
  );
  const matchedStripped = apiJobIds.filter(id => syncedExternalIdsStripped.has(id));
  const unmatchedStripped = apiJobIds.filter(id => !syncedExternalIdsStripped.has(id));
  console.log("API job_ids matching stripped synced externalIds:", matchedStripped.length);
  console.log("API job_ids NOT matching stripped synced externalIds:", unmatchedStripped.length);
  if (unmatchedStripped.length > 0) {
    console.log("Unmatched (stripped) job_ids:", unmatchedStripped);
  }

  // 5. Check NULL lastSyncedAt jobs
  const nullSyncJobs = await prisma.job.findMany({
    where: { source: "MICRO1", lastSyncedAt: null },
    select: { externalId: true, title: true },
  });
  const nullExternalIdsStripped = new Set(
    nullSyncJobs.map(j => j.externalId.replace(/\?utm_.*$/, ""))
  );
  console.log("\nNULL lastSyncedAt jobs:", nullSyncJobs.length);
  const nullMatched = apiJobIds.filter(id => nullExternalIdsStripped.has(id));
  console.log("API job_ids matching NULL externalIds:", nullMatched.length);
  if (nullMatched.length > 0) {
    console.log("Matching NULL job_ids:", nullMatched);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
