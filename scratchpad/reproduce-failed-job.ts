import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import axios from "axios";
import { Micro1Client } from "../src/clients/micro1.client.js";
import { Micro1Parser } from "../src/parsers/micro1.parser.js";
import { Micro1Mapper } from "../src/mappers/micro1.mapper.js";
import { Micro1Processor } from "../src/processors/micro1.processor.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const apiClient = axios.create({
  baseURL: "https://prod-api.micro1.ai/api/v1",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

async function getJobs(page: number, limit: number = 18) {
  const { data } = await apiClient.post(
    "/job/portal",
    {
      action: "get_all_jobs",
      filters: { type: ["EXPERT"] },
    },
    {
      params: { page, limit, keyword: "" },
    }
  );
  return data;
}

const syncStart = new Date("2026-08-10T17:17:04.831Z");

async function main() {
  // 1. Get all 283 synced externalIds from the database
  const syncedJobs = await prisma.job.findMany({
    where: { source: "MICRO1", lastSyncedAt: syncStart },
    select: { externalId: true },
  });
  const syncedExternalIds = new Set(syncedJobs.map(j => j.externalId));
  console.log("Synced jobs in DB:", syncedJobs.length);

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

  // 3. Find unmatched job_ids
  const unmatched = allSummaries.filter(s => !syncedExternalIds.has(s.job_id));
  console.log("\n=== Unmatched jobs (not in synced DB) ===");
  unmatched.forEach(s => {
    console.log(`  job_id: ${s.job_id}, job_name: ${s.job_name}, apply_url: ${s.apply_url}`);
  });

  // 4. Check if unmatched jobs are in the NULL lastSyncedAt set
  const nullSyncJobs = await prisma.job.findMany({
    where: { source: "MICRO1", lastSyncedAt: null },
    select: { externalId: true, title: true },
  });
  const nullExternalIds = new Set(
    nullSyncJobs.map(j => j.externalId.replace(/\?utm_.*$/, ""))
  );
  console.log("\n=== Checking unmatched jobs against NULL lastSyncedAt ===");
  unmatched.forEach(s => {
    const inNull = nullExternalIds.has(s.job_id);
    console.log(`  job_id: ${s.job_id} - in NULL set: ${inNull}`);
  });

  // 5. Try to process each unmatched job using the Micro1 processor
  console.log("\n=== Attempting to process unmatched jobs ===");

  const micro1Client = new Micro1Client();
  const micro1Parser = new Micro1Parser();
  const micro1Mapper = new Micro1Mapper();
  const processor = new Micro1Processor(micro1Client, micro1Parser, micro1Mapper);

  for (const summary of unmatched) {
    console.log(`\n--- Processing: ${summary.job_name} (job_id: ${summary.job_id}) ---`);
    try {
      const job = await processor.process(summary.apply_url);
      console.log(`SUCCESS: externalId=${job.externalId}, title=${job.title}`);
    } catch (err: any) {
      console.error(`FAILED: externalId=${summary.job_id}`);
      console.error("Error:", err.message);
      console.error("Stack:", err.stack);
      if (err.code) console.error("Code:", err.code);
      if (err.cause) console.error("Cause:", err.cause);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
