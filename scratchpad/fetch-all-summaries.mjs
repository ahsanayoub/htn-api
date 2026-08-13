import "dotenv/config";
import axios from "axios";

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

async function main() {
  const firstPage = await getJobs(1);
  console.log("Total:", firstPage.total, "Page:", firstPage.page, "Limit:", firstPage.limit, "TotalPages:", firstPage.total_pages);

  const allSummaries = [...firstPage.data];
  for (let page = 2; page <= firstPage.total_pages; page++) {
    const portal = await getJobs(page);
    allSummaries.push(...portal.data);
    console.log(`Page ${page}/${firstPage.total_pages}: ${portal.data.length} jobs`);
  }

  console.log("\nTotal job summaries:", allSummaries.length);

  // Write to file
  const fs = await import("fs");
  const summaries = allSummaries.map(s => ({
    job_name: s.job_name,
    company_name: s.company_name,
    apply_url: s.apply_url,
    job_id: s.job_id,
  }));
  fs.writeFileSync("scratchpad/micro1-summaries-all.json", JSON.stringify(summaries, null, 2));
  console.log("Summaries written to scratchpad/micro1-summaries-all.json");
}

main().catch(console.error);
