import { JobSource, type SourceSync } from "@prisma/client";
import prisma from "../prisma/client.js";
import { JobRepository } from "../repositories/job.repository.js";
import { OrganizationRepository } from "../repositories/organization.repository.js";
import type { SourceAdapter, SourceJobSummary } from "../adapters/source.adapter.js";

export interface SyncResult {
  source: JobSource;
  syncStart: Date;
  syncEnd: Date;
  totalSeen: number;
  totalCreated: number;
  totalUpdated: number;
  totalFailed: number;
  totalStale: number;
  staleJobs: { id: string; externalId: string | null }[];
}

export class SourceSyncService {
  private readonly jobRepository: JobRepository;
  private readonly organizationRepository: OrganizationRepository;

  constructor(
    private readonly adapter: SourceAdapter,
  ) {
    this.jobRepository = new JobRepository();
    this.organizationRepository = new OrganizationRepository();
  }

  async sync(limit?: number): Promise<SyncResult> {
    const syncStart = new Date();

    console.log(`[${this.adapter.source}] Starting sync at ${syncStart.toISOString()}`);

    const summaries = await this.adapter.getJobSummaries(syncStart);
    console.log(`[${this.adapter.source}] Found ${summaries.length} job summaries in source feed`);

    const toProcess = limit ? summaries.slice(0, limit) : summaries;
    console.log(`[${this.adapter.source}] Processing ${toProcess.length} jobs${limit ? ` (limited to ${limit})` : ""}`);

    let created = 0;
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const summary = toProcess[i];
      console.log(`[${this.adapter.source}] Processing ${i + 1}/${toProcess.length}: ${summary.title}`);

      try {
        const job = await this.adapter.getJobDetails(summary);

        const orgId = await this.organizationRepository.findOrCreate({
          name: job.company.name,
        });

        const upsertData = this.adapter.mapToUpsertData(job, orgId, syncStart);
        const result = await this.jobRepository.upsert(upsertData);

        if (result === "created") {
          created++;
        } else {
          updated++;
        }
      } catch (err) {
        failed++;
        console.error(`[${this.adapter.source}] Failed: ${summary.title}`, err);
      }
    }

    const syncEnd = new Date();

    await this.upsertSourceSyncRecord(syncStart, syncEnd, toProcess.length, created, updated, failed);

    const staleJobs = await this.jobRepository.findStaleJobs(this.adapter.source, syncStart);
    console.log(`[${this.adapter.source}] Stale jobs (not seen in this cycle): ${staleJobs.length}`);

    const staleClosedCount = await this.jobRepository.markStaleJobsAsClosed(this.adapter.source, syncStart);
    if (staleClosedCount > 0) {
      console.log(`[${this.adapter.source}] Marked ${staleClosedCount} stale jobs as CLOSED`);
    }

    const result: SyncResult = {
      source: this.adapter.source,
      syncStart,
      syncEnd,
      totalSeen: toProcess.length,
      totalCreated: created,
      totalUpdated: updated,
      totalFailed: failed,
      totalStale: staleJobs.length,
      staleJobs,
    };

    console.log(`[${this.adapter.source}] Sync complete: ${created} created, ${updated} updated, ${failed} failed, ${staleJobs.length} stale`);

    return result;
  }

  private async upsertSourceSyncRecord(
    syncStart: Date,
    syncEnd: Date,
    totalSeen: number,
    totalCreated: number,
    totalUpdated: number,
    totalFailed: number,
  ): Promise<void> {
    await prisma.sourceSync.upsert({
      where: { source: this.adapter.source },
      create: {
        source: this.adapter.source,
        lastSyncAt: syncEnd,
        lastSyncStart: syncStart,
        totalSeen,
        totalCreated,
        totalUpdated,
        totalFailed,
      },
      update: {
        lastSyncAt: syncEnd,
        lastSyncStart: syncStart,
        totalSeen,
        totalCreated,
        totalUpdated,
        totalFailed,
      },
    });
  }
}
