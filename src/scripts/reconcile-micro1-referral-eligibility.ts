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
import {
  eligibilityCreateData,
  reconcileMicro1ReferralEligibility,
  type Micro1EligibilityJob,
  type PreparedEligibilityCreate,
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
    prepareCreates: async (externalIds) => {
      const prepared: PreparedEligibilityCreate[] = [];
      const seenAt = new Date();
      for (const externalId of externalIds) {
        const match = summaries.get(externalId);
        if (!match?.referralUrl) {
          throw new Error(`Eligible job ${externalId} is missing a referral summary`);
        }
        const job = await adapter.getJobDetails(match);
        const organizationName = job.company.name?.trim();
        if (!organizationName) {
          throw new Error(`Eligible job ${externalId} is missing an organization name`);
        }
        prepared.push({
          externalId,
          organizationName,
          data: eligibilityCreateData(
            // Organization id is assigned inside the write transaction.
            adapter.mapToUpsertData(job, "pending-organization", seenAt),
            externalId,
          ),
        });
      }
      return prepared;
    },
    runTransaction: (work) =>
      prisma.$transaction((tx) => work(tx), { maxWait: 10_000, timeout: 120_000 }),
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
