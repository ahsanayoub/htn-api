import { HtnAtsSyncStatus, Prisma } from "@prisma/client";
import prisma from "../prisma/client.js";
import { ATS_SYNC_STALE_SYNCING_MS, nextRetryAt } from "./htn-ats-sync-policy.js";

export type HtnAtsCandidateSyncRecord = {
  id: string;
  htnCandidateId: string;
  status: HtnAtsSyncStatus;
  attemptCount: number;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  lastError: string | null;
  lastErrorCode: string | null;
  atsCandidateId: string | null;
  syncedAt: Date | null;
};

export type MarkCandidateSyncedInput = {
  atsCandidateId: string;
  attemptCount: number;
};

export type MarkCandidateFailureInput = {
  attemptCount: number;
  lastError: string;
  lastErrorCode: string;
  nextRetryAt?: Date | null;
};

export interface HtnAtsCandidateSyncStore {
  ensurePending(htnCandidateId: string, now?: Date): Promise<HtnAtsCandidateSyncRecord>;
  getByHtnCandidateId(htnCandidateId: string): Promise<HtnAtsCandidateSyncRecord | null>;
  claimDue(options?: { htnCandidateId?: string; now?: Date }): Promise<HtnAtsCandidateSyncRecord | null>;
  markSynced(id: string, input: MarkCandidateSyncedInput): Promise<HtnAtsCandidateSyncRecord>;
  markRetryable(id: string, input: MarkCandidateFailureInput): Promise<HtnAtsCandidateSyncRecord>;
  markPermanentFailure(id: string, input: MarkCandidateFailureInput): Promise<HtnAtsCandidateSyncRecord>;
}

function mapRow(row: {
  id: string;
  htnCandidateId: string;
  status: HtnAtsSyncStatus;
  attemptCount: number;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  lastError: string | null;
  lastErrorCode: string | null;
  atsCandidateId: string | null;
  syncedAt: Date | null;
}): HtnAtsCandidateSyncRecord {
  return {
    id: row.id,
    htnCandidateId: row.htnCandidateId,
    status: row.status,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
    nextRetryAt: row.nextRetryAt,
    lastError: row.lastError,
    lastErrorCode: row.lastErrorCode,
    atsCandidateId: row.atsCandidateId,
    syncedAt: row.syncedAt,
  };
}

type HtnAtsCandidateSyncPrismaClient = Pick<typeof prisma, "$transaction" | "htnAtsCandidateSync">;

export function createPrismaHtnAtsCandidateSyncStore(
  client: HtnAtsCandidateSyncPrismaClient = prisma,
): HtnAtsCandidateSyncStore {
  return {
    async ensurePending(htnCandidateId, now = new Date()) {
      const row = await client.htnAtsCandidateSync.upsert({
        where: { htnCandidateId },
        create: {
          htnCandidateId,
          status: HtnAtsSyncStatus.PENDING,
          attemptCount: 0,
          nextRetryAt: now,
        },
        update: {},
      });
      return mapRow(row);
    },

    async getByHtnCandidateId(htnCandidateId) {
      const row = await client.htnAtsCandidateSync.findUnique({ where: { htnCandidateId } });
      return row ? mapRow(row) : null;
    },

    async claimDue(options = {}) {
      const now = options.now ?? new Date();
      const staleBefore = new Date(now.getTime() - ATS_SYNC_STALE_SYNCING_MS);
      const candidateFilter = options.htnCandidateId
        ? Prisma.sql`AND s."htnCandidateId" = ${options.htnCandidateId}::uuid`
        : Prisma.sql``;

      return client.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT s.id
          FROM "HtnAtsCandidateSync" s
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
          ${candidateFilter}
          ORDER BY s."nextRetryAt" NULLS FIRST, s."createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `;
        if (!rows[0]) return null;
        const updated = await tx.htnAtsCandidateSync.update({
          where: { id: rows[0].id },
          data: { status: HtnAtsSyncStatus.SYNCING, lastAttemptAt: now },
        });
        return mapRow(updated);
      });
    },

    async markSynced(id, input) {
      const updated = await client.htnAtsCandidateSync.update({
        where: { id },
        data: {
          status: HtnAtsSyncStatus.SYNCED,
          attemptCount: input.attemptCount,
          atsCandidateId: input.atsCandidateId,
          syncedAt: new Date(),
          lastError: null,
          lastErrorCode: null,
          nextRetryAt: null,
        },
      });
      return mapRow(updated);
    },

    async markRetryable(id, input) {
      const updated = await client.htnAtsCandidateSync.update({
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
      const updated = await client.htnAtsCandidateSync.update({
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

export function createMemoryHtnAtsCandidateSyncStore(
  seed: HtnAtsCandidateSyncRecord[] = [],
): HtnAtsCandidateSyncStore {
  const records = new Map(seed.map((row) => [row.id, { ...row }]));
  let chain = Promise.resolve();
  let seq = seed.length + 1;

  function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    async ensurePending(htnCandidateId, now = new Date()) {
      const existing = [...records.values()].find((row) => row.htnCandidateId === htnCandidateId);
      if (existing) return { ...existing };
      const created: HtnAtsCandidateSyncRecord = {
        id: `cand-sync-${seq++}`,
        htnCandidateId,
        status: HtnAtsSyncStatus.PENDING,
        attemptCount: 0,
        lastAttemptAt: null,
        nextRetryAt: now,
        lastError: null,
        lastErrorCode: null,
        atsCandidateId: null,
        syncedAt: null,
      };
      records.set(created.id, created);
      return { ...created };
    },

    async getByHtnCandidateId(htnCandidateId) {
      return [...records.values()].find((row) => row.htnCandidateId === htnCandidateId) ?? null;
    },

    claimDue(options = {}) {
      return withLock(() => {
        const now = options.now ?? new Date();
        const staleBefore = new Date(now.getTime() - ATS_SYNC_STALE_SYNCING_MS);
        const due = [...records.values()].filter((row) => {
          if (options.htnCandidateId && row.htnCandidateId !== options.htnCandidateId) return false;
          if (row.status === HtnAtsSyncStatus.PENDING && (row.nextRetryAt == null || row.nextRetryAt <= now)) {
            return true;
          }
          if (
            row.status === HtnAtsSyncStatus.SYNCING &&
            row.lastAttemptAt != null &&
            row.lastAttemptAt < staleBefore
          ) {
            return true;
          }
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
      if (!row) throw new Error(`candidate sync record ${id} not found`);
      Object.assign(row, {
        status: HtnAtsSyncStatus.SYNCED,
        attemptCount: input.attemptCount,
        atsCandidateId: input.atsCandidateId,
        syncedAt: new Date(),
        lastError: null,
        lastErrorCode: null,
        nextRetryAt: null,
      });
      return { ...row };
    },

    async markRetryable(id, input) {
      const row = records.get(id);
      if (!row) throw new Error(`candidate sync record ${id} not found`);
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
      if (!row) throw new Error(`candidate sync record ${id} not found`);
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
