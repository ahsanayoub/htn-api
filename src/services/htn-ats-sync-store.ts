import { HtnAtsSyncStatus, Prisma } from "@prisma/client";
import prisma from "../prisma/client.js";
import { ATS_SYNC_STALE_SYNCING_MS, nextRetryAt } from "./htn-ats-sync-policy.js";

export type HtnAtsSyncRecord = {
  id: string;
  applicationId: string;
  status: HtnAtsSyncStatus;
  attemptCount: number;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  lastError: string | null;
  lastErrorCode: string | null;
  recruiterId: string | null;
  recruiterOrganizationId: string | null;
  atsCandidateId: string | null;
  atsApplicationId: string | null;
  atsJobId: string | null;
  syncedAt: Date | null;
};

export type MarkSyncedInput = {
  atsCandidateId: string;
  atsApplicationId: string;
  atsJobId: string;
  attemptCount: number;
};

export type MarkFailureInput = {
  attemptCount: number;
  lastError: string;
  lastErrorCode: string;
  nextRetryAt?: Date | null;
};

export interface HtnAtsSyncStore {
  getByApplicationId(applicationId: string): Promise<HtnAtsSyncRecord | null>;
  claimDue(options?: { applicationId?: string; now?: Date }): Promise<HtnAtsSyncRecord | null>;
  markSynced(id: string, input: MarkSyncedInput): Promise<HtnAtsSyncRecord>;
  markRetryable(id: string, input: MarkFailureInput): Promise<HtnAtsSyncRecord>;
  markPermanentFailure(id: string, input: MarkFailureInput): Promise<HtnAtsSyncRecord>;
}

function mapRow(row: {
  id: string;
  applicationId: string;
  status: HtnAtsSyncStatus;
  attemptCount: number;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  lastError: string | null;
  lastErrorCode: string | null;
  recruiterId?: string | null;
  recruiterOrganizationId?: string | null;
  atsCandidateId: string | null;
  atsApplicationId: string | null;
  atsJobId: string | null;
  syncedAt: Date | null;
}): HtnAtsSyncRecord {
  return {
    id: row.id,
    applicationId: row.applicationId,
    status: row.status,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
    nextRetryAt: row.nextRetryAt,
    lastError: row.lastError,
    lastErrorCode: row.lastErrorCode,
    recruiterId: row.recruiterId ?? null,
    recruiterOrganizationId: row.recruiterOrganizationId ?? null,
    atsCandidateId: row.atsCandidateId,
    atsApplicationId: row.atsApplicationId,
    atsJobId: row.atsJobId,
    syncedAt: row.syncedAt,
  };
}

export function createPrismaHtnAtsSyncStore(client: Pick<typeof prisma, "$transaction"> = prisma): HtnAtsSyncStore {
  return {
    async getByApplicationId(applicationId) {
      const row = await prisma.htnAtsSubmissionSync.findUnique({ where: { applicationId } });
      return row ? mapRow(row) : null;
    },

    async claimDue(options = {}) {
      const now = options.now ?? new Date();
      const staleBefore = new Date(now.getTime() - ATS_SYNC_STALE_SYNCING_MS);
        const applicationFilter = options.applicationId
        ? Prisma.sql`AND s."applicationId" = ${options.applicationId}::uuid`
        : Prisma.sql``;

      return client.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT s.id
          FROM "HtnAtsSubmissionSync" s
          WHERE (
            (
              s.status = 'PENDING'::"HtnAtsSyncStatus"
              AND (s."nextRetryAt" IS NULL OR s."nextRetryAt" <= ${now})
            )
            OR (
              s.status = 'SYNCING'::"HtnAtsSyncStatus"
              AND s."lastAttemptAt" IS NOT NULL
              AND s."lastAttemptAt" < ${staleBefore}
            )
          )
          ${applicationFilter}
          ORDER BY s."nextRetryAt" NULLS FIRST, s."createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `;
        if (!rows[0]) return null;
        const updated = await tx.htnAtsSubmissionSync.update({
          where: { id: rows[0].id },
          data: { status: HtnAtsSyncStatus.SYNCING, lastAttemptAt: now },
        });
        return mapRow(updated);
      });
    },

    async markSynced(id, input) {
      const updated = await prisma.htnAtsSubmissionSync.update({
        where: { id },
        data: {
          status: HtnAtsSyncStatus.SYNCED,
          attemptCount: input.attemptCount,
          atsCandidateId: input.atsCandidateId,
          atsApplicationId: input.atsApplicationId,
          atsJobId: input.atsJobId,
          syncedAt: new Date(),
          lastError: null,
          lastErrorCode: null,
          nextRetryAt: null,
        },
      });
      return mapRow(updated);
    },

    async markRetryable(id, input) {
      const updated = await prisma.htnAtsSubmissionSync.update({
        where: { id },
        data: {
          status: HtnAtsSyncStatus.PENDING,
          attemptCount: input.attemptCount,
          lastError: input.lastError,
          lastErrorCode: input.lastErrorCode,
          nextRetryAt: input.nextRetryAt ?? nextRetryAt(input.attemptCount),
        },
      });
      return mapRow(updated);
    },

    async markPermanentFailure(id, input) {
      const updated = await prisma.htnAtsSubmissionSync.update({
        where: { id },
        data: {
          status: HtnAtsSyncStatus.FAILED,
          attemptCount: input.attemptCount,
          lastError: input.lastError,
          lastErrorCode: input.lastErrorCode,
          nextRetryAt: null,
        },
      });
      return mapRow(updated);
    },
  };
}

export function createMemoryHtnAtsSyncStore(seed: HtnAtsSyncRecord[] = []): HtnAtsSyncStore {
  const records = new Map(seed.map((row) => [row.id, { ...row }]));
  let chain = Promise.resolve();

  function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  return {
    async getByApplicationId(applicationId) {
      return [...records.values()].find((row) => row.applicationId === applicationId) ?? null;
    },

    claimDue(options = {}) {
      return withLock(() => {
        const now = options.now ?? new Date();
        const staleBefore = new Date(now.getTime() - ATS_SYNC_STALE_SYNCING_MS);
        const due = [...records.values()].filter((row) => {
          if (options.applicationId && row.applicationId !== options.applicationId) return false;
          if (row.status === HtnAtsSyncStatus.PENDING && (row.nextRetryAt == null || row.nextRetryAt <= now)) return true;
          if (row.status === HtnAtsSyncStatus.SYNCING && row.lastAttemptAt != null && row.lastAttemptAt < staleBefore) return true;
          return false;
        });
        due.sort((a, b) => {
          const aTime = a.nextRetryAt?.getTime() ?? 0;
          const bTime = b.nextRetryAt?.getTime() ?? 0;
          return aTime - bTime;
        });
        const claimed = due[0];
        if (!claimed) return null;
        claimed.status = HtnAtsSyncStatus.SYNCING;
        claimed.lastAttemptAt = now;
        records.set(claimed.id, claimed);
        return { ...claimed };
      });
    },

    async markSynced(id, input) {
      const row = records.get(id);
      if (!row) throw new Error(`sync record ${id} not found`);
      Object.assign(row, {
        status: HtnAtsSyncStatus.SYNCED,
        attemptCount: input.attemptCount,
        atsCandidateId: input.atsCandidateId,
        atsApplicationId: input.atsApplicationId,
        atsJobId: input.atsJobId,
        syncedAt: new Date(),
        lastError: null,
        lastErrorCode: null,
        nextRetryAt: null,
      });
      return { ...row };
    },

    async markRetryable(id, input) {
      const row = records.get(id);
      if (!row) throw new Error(`sync record ${id} not found`);
      Object.assign(row, {
        status: HtnAtsSyncStatus.PENDING,
        attemptCount: input.attemptCount,
        lastError: input.lastError,
        lastErrorCode: input.lastErrorCode,
        nextRetryAt: input.nextRetryAt ?? nextRetryAt(input.attemptCount),
      });
      return { ...row };
    },

    async markPermanentFailure(id, input) {
      const row = records.get(id);
      if (!row) throw new Error(`sync record ${id} not found`);
      Object.assign(row, {
        status: HtnAtsSyncStatus.FAILED,
        attemptCount: input.attemptCount,
        lastError: input.lastError,
        lastErrorCode: input.lastErrorCode,
        nextRetryAt: null,
      });
      return { ...row };
    },
  };
}
