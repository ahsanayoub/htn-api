import {
    micro1Client,
    micro1Processor,
    notionRepository,
  } from "../index.js";
  
  async function main() {
    const firstPage = await micro1Client.getJobs(1);
  
    if (!firstPage.data.length) {
      throw new Error("No jobs returned.");
    }
  
    const totalJobs = firstPage.total;
    const pageSize = firstPage.data.length;
    const totalPages = Math.ceil(totalJobs / pageSize);
  
    console.log(`Importing ${totalJobs} jobs across ${totalPages} pages...`);
  
    let created = 0;
    let updated = 0;
    let failed = 0;
  
    for (let page = 1; page <= totalPages; page++) {
      const portal =
        page === 1 ? firstPage : await micro1Client.getJobs(page);
  
      console.log(`\nPage ${page}/${totalPages}`);
  
      for (const summary of portal.data) {
        try {
          console.log(`Processing ${summary.job_name}`);
  
          const job = await micro1Processor.process(summary.apply_url);
          const result = await notionRepository.save(job);
  
          if (result === "created") {
            created++;
          } else {
            updated++;
          }
  
          console.log(`${result.toUpperCase()}: ${job.title}`);
        } catch (err) {
          failed++;
          console.error(`Failed: ${summary.job_name}`, err);
        }
      }
    }
  
    console.log(`
  Import Complete
  ---------------
  Created : ${created}
  Updated : ${updated}
  Failed  : ${failed}
  `);
  }
  
  main().catch(console.error);