import { JobSource, JobStatus } from "@prisma/client";
import prisma from "../prisma/client.js";
import { JobRepository } from "../repositories/job.repository.js";
import { OrganizationRepository } from "../repositories/organization.repository.js";
import type { SourceAdapter } from "../adapters/source.adapter.js";
import {
  acquireSourceLock,
  releaseSourceLock,
  type HeldSourceLock,
} from "./source-lock.js";

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
  skipped?: boolean;
}

function floorToSeconds(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
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

    const connectionString = process.env.DATABASE_URL ?? "";
    const lock = await acquireSourceLock(this.adapter.source, connectionString);

    if (lock === null) {
      console.warn(
        `[${this.adapter.source}] Another sync is already running for this source — skipping to avoid concurrent ingestion`,
      );
      const syncEnd = new Date();
      return {
        source: this.adapter.source,
        syncStart,
        syncEnd,
        totalSeen: 0,
        totalCreated: 0,
        totalUpdated: 0,
        totalFailed: 0,
        totalStale: 0,
        staleJobs: [],
        skipped: true,
      };
    }

    try {
      return await this.runSync(syncStart, limit);
    } finally {
      await releaseSourceLock(lock);
    }
  }

  private async runSync(syncStart: Date, limit?: number): Promise<SyncResult> {
    // Network fetching happens OUTSIDE any Prisma transaction. The
    // session-scoped advisory lock acquired in sync() is held on a
    // dedicated pg.Client and is independent of the Prisma pool.
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
        // Each upsert is its own short transaction inside JobRepository.upsert.
        // No long-lived Prisma transaction is held across the loop.
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

    // Short standalone write for SourceSync bookkeeping. Uses the normal
    // Prisma pool — no outer transaction is held during this call.
    await this.upsertSourceSyncRecord(
      syncStart,
      syncEnd,
      toProcess.length,
      created,
      updated,
      failed,
    );

    let staleJobs: { id: string; externalId: string | null }[] = [];

    if (toProcess.length === 0) {
      console.warn(
        `[${this.adapter.source}] Source returned 0 jobs — skipping stale-closure to avoid data loss`,
      );
    } else {
      const cutoff = floorToSeconds(syncStart);
      // Short standalone reads + write. No outer transaction is held.
      staleJobs = await prisma.job.findMany({
        where: {
          source: this.adapter.source,
          lastSeenAt: { lt: cutoff },
        },
        select: { id: true, externalId: true },
      });
      console.log(`[${this.adapter.source}] Stale jobs (not seen in this cycle): ${staleJobs.length}`);

      const staleClosedCount = await this.closeStaleJobs(this.adapter.source, syncStart);
      if (staleClosedCount > 0) {
        console.log(`[${this.adapter.source}] Marked ${staleClosedCount} stale jobs as CLOSED`);
      }
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

  private async closeStaleJobs(
    source: JobSource,
    since: Date,
  ): Promise<number> {
    const cutoff = floorToSeconds(since);
    const result = await prisma.job.updateMany({
      where: {
        source,
        lastSeenAt: { lt: cutoff },
        status: {
          notIn: [JobStatus.CLOSED, JobStatus.ARCHIVED],
        },
      },
      data: {
        status: JobStatus.CLOSED,
      },
    });
    return result.count;
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

// Re-export for tests
export type { HeldSourceLock };
