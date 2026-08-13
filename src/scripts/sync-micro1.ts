import "dotenv/config";
import { Micro1Client } from "../clients/micro1.client.js";
import { Micro1Parser } from "../parsers/micro1.parser.js";
import { Micro1Mapper } from "../mappers/micro1.mapper.js";
import { Micro1Processor } from "../processors/micro1.processor.js";
import { Micro1SyncAdapter } from "../adapters/micro1.adapter.js";
import { SourceSyncService } from "../services/sync.service.js";

async function main() {
  const micro1Client = new Micro1Client();
  const micro1Parser = new Micro1Parser();
  const micro1Mapper = new Micro1Mapper();

  const micro1Processor = new Micro1Processor(
    micro1Client,
    micro1Parser,
    micro1Mapper,
  );

  const adapter = new Micro1SyncAdapter(micro1Client, micro1Processor);
  const syncService = new SourceSyncService(adapter);

  const result = await syncService.sync();

  console.log(`
Sync Report
-----------
Source:           ${result.source}
Sync Start:       ${result.syncStart.toISOString()}
Sync End:         ${result.syncEnd.toISOString()}
Duration:         ${result.syncEnd.getTime() - result.syncStart.getTime()}ms
Jobs Discovered:  ${result.totalSeen}
Jobs Created:     ${result.totalCreated}
Jobs Updated:     ${result.totalUpdated}
Jobs Failed:      ${result.totalFailed}
Stale Jobs:       ${result.totalStale}
  `);

  if (result.staleJobs.length > 0) {
    console.log("Stale job IDs (not modified, for review only):");
    result.staleJobs.forEach((job) => {
      console.log(`  - ${job.id} (externalId: ${job.externalId ?? "null"})`);
    });
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
