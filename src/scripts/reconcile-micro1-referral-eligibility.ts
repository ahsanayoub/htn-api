/**
 * Reconcile HTN Micro1 job status with the referral eligible-jobs feed.
 *
 * Dry run (no job writes):
 *   npm run reconcile:micro1-referral:dry-run
 *
 * This does not run SourceSyncService and does not close jobs for other sources.
 */
import "dotenv/config";
import { JobSource } from "@prisma/client";

import { Micro1SyncAdapter } from "../adapters/micro1.adapter.js";
import { Micro1Client } from "../clients/micro1.client.js";
import { getMicro1DiscoverySource } from "../config/micro1.config.js";
import { Micro1Mapper } from "../mappers/micro1.mapper.js";
import { Micro1Parser } from "../parsers/micro1.parser.js";
import { Micro1Processor } from "../processors/micro1.processor.js";
import prisma from "../prisma/client.js";
import { JobRepository } from "../repositories/job.repository.js";
import { OrganizationRepository } from "../repositories/organization.repository.js";
import {
  eligibilityCreateData,
  reconcileMicro1ReferralEligibility,
  type Micro1EligibilityJob,
} from "../services/micro1-referral-eligibility.js";
import { captureReferralInventory } from "../services/micro1-referral-inventory.js";
import type { SourceJobSummary } from "../adapters/source.adapter.js";
import { acquireSourceLock, releaseSourceLock, type HeldSourceLock } from "../services/source-lock.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const referralDiscovery = getMicro1DiscoverySource() === "referral";
  const client = new Micro1Client();
  const adapter = new Micro1SyncAdapter(
    client,
    new Micro1Processor(client, new Micro1Parser(), new Micro1Mapper()),
  );
  const jobRepository = new JobRepository();
  const organizationRepository = new OrganizationRepository();
  const summaries = new Map<string, SourceJobSummary>();
  let lock: HeldSourceLock | null = null;

  const report = await reconcileMicro1ReferralEligibility({
    dryRun,
    referralDiscovery,
    acquireLock: async () => {
      lock = await acquireSourceLock(JobSource.MICRO1, process.env.DATABASE_URL ?? "");
      return lock !== null;
    },
    releaseLock: async () => {
      if (lock) await releaseSourceLock(lock);
    },
    loadSnapshot: () =>
      captureReferralInventory(async (page, limit) => {
        const payload = await client.getEligibleJobs(page, limit);
        for (const row of payload.data) {
          const externalId = row.job_id?.trim();
          if (!externalId || summaries.has(externalId)) continue;
          summaries.set(externalId, {
            applyUrl: row.apply_url,
            referralUrl: row.apply_url,
            title: row.job_name,
            companyName: row.company_name,
            externalId,
          });
        }
        return payload;
      }),
    listJobs: async () =>
      prisma.job.findMany({
        where: { source: JobSource.MICRO1 },
        select: { id: true, externalId: true, status: true, source: true },
      }) as Promise<Micro1EligibilityJob[]>,
    setStatus: async (id, status) => {
      await prisma.job.updateMany({
        where: { id, source: JobSource.MICRO1 },
        data: { status },
      });
    },
    createJob: async (externalId) => {
      const match = summaries.get(externalId);
      if (!match?.referralUrl) {
        throw new Error(`Eligible job ${externalId} is missing a referral summary`);
      }
      const job = await adapter.getJobDetails(match);
      const organizationId = await organizationRepository.findOrCreate({
        name: job.company.name,
      });
      const upsert = adapter.mapToUpsertData(job, organizationId, new Date());
      await jobRepository.upsert(eligibilityCreateData(upsert, externalId));
    },
  });

  console.log(JSON.stringify(report, null, 2));
  if (!report.applied && report.reason) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "reconciliation failed";
  console.error(message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]"));
  process.exitCode = 1;
});
