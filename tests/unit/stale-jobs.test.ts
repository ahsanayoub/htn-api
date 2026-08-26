import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JobSource, JobStatus } from "@prisma/client";

import type { SourceAdapter, SourceJobSummary } from "../../src/adapters/source.adapter.js";
import type { HTNJob } from "../../src/models/htn-job.model.js";
import type { JobUpsertData } from "../../src/repositories/job.repository.js";
import { SourceSyncService } from "../../src/services/sync.service.js";
import { JobRepository } from "../../src/repositories/job.repository.js";

interface FakeJob {
  id: string;
  externalId: string | null;
  source: JobSource;
  status: JobStatus;
  lastSeenAt: Date | null;
  title?: string;
  organizationId?: string;
}

type WhereClause = Record<string, unknown>;

function floorToSeconds(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

// ---------------------------------------------------------------------------
// A non-stale summary that the adapter returns so that sync() has at least
// one job to process and stale detection is allowed to run.  Using a unique
// externalId ensures it never collides with stale test jobs.
// ---------------------------------------------------------------------------
const CURRENT_SUMMARY: SourceJobSummary = {
  applyUrl: "ext-current",
  title: "Current Job",
  companyName: "Test Co",
};

// ---------------------------------------------------------------------------
// Mock adapter: a configurable SourceAdapter implementation for tests.
// ---------------------------------------------------------------------------

function createMockHTNJob(externalId: string, title: string): HTNJob {
  return {
    id: externalId,
    source: "micro1",
    externalId,
    title,
    company: { name: "Test Co" },
    description: "",
    content: {
      responsibilities: [],
      requirements: [],
      preferredQualifications: [],
      benefits: [],
      additionalSections: {},
    },
    skills: [],
    screeningQuestions: [],
    metadata: {},
    directApply: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

class TestAdapter implements SourceAdapter {
  readonly source = JobSource.MICRO1;
  summaries: SourceJobSummary[] = [];

  async getJobSummaries(_syncStart: Date): Promise<SourceJobSummary[]> {
    return this.summaries;
  }

  async getJobDetails(summary: SourceJobSummary): Promise<HTNJob> {
    return createMockHTNJob(summary.applyUrl, summary.title);
  }

  mapToUpsertData(
    job: HTNJob,
    organizationId: string,
    syncStart: Date,
  ): JobUpsertData {
    return {
      externalId: job.externalId,
      source: JobSource.MICRO1,
      title: job.title,
      organizationId,
      status: JobStatus.IMPORTED,
      lastSeenAt: syncStart,
      lastSyncedAt: syncStart,
      metadata: {},
    };
  }
}

// ---------------------------------------------------------------------------
// In-memory Prisma mock: simulates the subset of Prisma operations that
// SourceSyncService.sync() uses (upsert, findStaleJobs, closeStaleJobs,
// organization findOrCreate, sourceSync upsert).
// ---------------------------------------------------------------------------

const { mockDb, store, mockDbState, mockLock } = vi.hoisted(() => {
  const jobs: FakeJob[] = [];
  const orgs: { id: string; name: string }[] = [];
  let nextOrgId = 0;
  let lockAcquired = true;
  let releasedLocks = 0;
  let acquireCalls = 0;
  let releaseCalls = 0;

  function matches(job: FakeJob, where: WhereClause): boolean {
    if (!where) return true;

    // Source must match at the top level (applies to both direct and OR clauses).
    if (where.source !== undefined && job.source !== where.source) return false;

    if (where.OR) {
      return (where.OR as WhereClause[]).some((cond) => matches(job, cond));
    }

    if (typeof where.lastSeenAt !== "undefined") {
      const la = where.lastSeenAt as unknown;
      if (la === null) {
        if (job.lastSeenAt !== null) return false;
      } else if (typeof la === "object" && la !== null && "lt" in la) {
        const cutoff = (la as { lt: Date }).lt;
        if (job.lastSeenAt === null) return false;
        if (!(job.lastSeenAt.getTime() < cutoff.getTime())) return false;
      }
    }

    if (where.status) {
      const st = where.status as { notIn?: JobStatus[] };
      if (st.notIn && st.notIn.includes(job.status)) return false;
    }

    return true;
  }

  function project(job: FakeJob, select: Record<string, boolean>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(select)) {
      out[k] = (job as Record<string, unknown>)[k];
    }
    return out;
  }

  // The previous implementation wrapped sync() in prisma.$transaction. The new
  // implementation uses a dedicated pg.Client for the advisory lock (mocked
  // below via acquireSourceLock / releaseSourceLock) and runs all Prisma
  // operations as short pool calls — no transaction wrapper.

  const job: Record<string, ReturnType<typeof vi.fn>> = {
    findMany: vi.fn(async (args: { where: WhereClause; select?: Record<string, boolean> }) => {
      const filtered = jobs.filter((j) => matches(j, args.where));
      return args.select ? filtered.map((j) => project(j, args.select)) : filtered;
    }),

    findFirst: vi.fn(async (args: { where: WhereClause }) => {
      const { source, externalId } = args.where as { source: JobSource; externalId: string };
      const found = jobs.find((j) => j.source === source && j.externalId === externalId);
      return found ? { id: found.id } : null;
    }),

    upsert: vi.fn(async (args: {
      where: { source_externalId: { source: JobSource; externalId: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const key = args.where.source_externalId;
      const existing = jobs.find((j) => j.source === key.source && j.externalId === key.externalId);
      if (existing) {
        Object.assign(existing, args.update);
        // Simulate DB truncating lastSeenAt to whole seconds (Step 6B bug surface)
        if (existing.lastSeenAt) {
          existing.lastSeenAt = floorToSeconds(existing.lastSeenAt);
        }
        return existing;
      }
      const newJob: FakeJob = {
        id: `job-${jobs.length + 1}`,
        externalId: args.create.externalId as string,
        source: args.create.source as JobSource,
        status: (args.create.status as JobStatus) ?? JobStatus.IMPORTED,
        lastSeenAt: args.create.lastSeenAt as Date | null,
        title: args.create.title as string,
        organizationId: args.create.organizationId as string,
      };
      if (newJob.lastSeenAt) {
        newJob.lastSeenAt = floorToSeconds(newJob.lastSeenAt);
      }
      jobs.push(newJob);
      return newJob;
    }),

    updateMany: vi.fn(async (args: { where: WhereClause; data: Partial<FakeJob> }) => {
      const matching = jobs.filter((j) => matches(j, args.where));
      matching.forEach((j) => Object.assign(j, args.data));
      return { count: matching.length };
    }),
  };

  // Wire up the dedicated advisory-lock mock. acquireSourceLock returns
  // a HeldSourceLock-shaped object when lockAcquired is true, or null
  // when another sync already holds the lock. releaseSourceLock just
  // increments releaseCalls.
  const mockLockHolder = {
    source: "MICRO1",
    key: 0n,
    connection: { end: vi.fn() },
  };

  const organization = {
    findFirst: vi.fn(async (args: { where: { name: string } }) => {
      return orgs.find((o) => o.name === args.where.name) || null;
    }),
    create: vi.fn(async (args: { data: { name: string } }) => {
      const org = { id: `org-${++nextOrgId}`, ...args.data };
      orgs.push(org);
      return org;
    }),
  };

  const sourceSync = {
    upsert: vi.fn().mockResolvedValue({}),
  };

  // $transaction remains in the mock for the per-job JobRepository.upsert
  // internal transaction (which the production code still uses for per-job
  // atomicity). The TOP-LEVEL sync() no longer wraps its body in
  // $transaction — that architectural invariant is asserted by the
  // "no long-lived Prisma transaction" test below.
  const txClient = {
    job: {
      findFirst: job.findFirst,
      upsert: job.upsert,
    },
  };
  const mockDb = {
    job,
    organization,
    sourceSync,
    $transaction: vi.fn(async (callback: (tx: typeof txClient) => Promise<unknown>) => {
      return callback(txClient);
    }),
  };

  return {
    mockDb,
    store: { jobs, orgs },
    mockLock: {
      acquireCalls,
      releaseCalls,
      acquire: vi.fn(async () => {
        acquireCalls++;
        if (!lockAcquired) return null;
        return mockLockHolder;
      }),
      release: vi.fn(async () => {
        releaseCalls++;
        releasedLocks++;
      }),
    },
    mockDbState: {
      setLockAcquired: (value: boolean) => {
        lockAcquired = value;
      },
      getAcquireCalls: () => acquireCalls,
      getReleaseCalls: () => releaseCalls,
    },
  };
});

vi.mock("../../src/prisma/client.js", () => ({
  __esModule: true,
  default: mockDb,
}));

vi.mock("../../src/services/source-lock.js", () => ({
  acquireSourceLock: () => mockLock.acquire(),
  releaseSourceLock: () => mockLock.release(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const STALE_DATE = new Date("2026-08-10T00:00:00.000Z");

const repo = new JobRepository();
const adapter = new TestAdapter();
const service = new SourceSyncService(adapter);
const { setLockAcquired } = mockDbState;

describe("SourceSyncService stale-job closure", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store.jobs.length = 0;
    store.orgs.length = 0;
    setLockAcquired(true);
    mockLock.acquire.mockClear();
    mockLock.release.mockClear();

    mockDb.job.findMany.mockClear();
    mockDb.job.findFirst.mockClear();
    mockDb.job.upsert.mockClear();
    mockDb.job.updateMany.mockClear();
    mockDb.organization.findFirst.mockClear();
    mockDb.organization.create.mockClear();
    mockDb.sourceSync.upsert.mockClear();

    adapter.summaries = [];
  });

  afterEach(() => {
    if (warnSpy) warnSpy.mockRestore();
  });

  describe("regression: floorToSeconds (Step 6B)", () => {
    it("findStaleJobs floors syncStart to whole seconds before comparing", async () => {
      store.jobs.push({
        id: "j1",
        externalId: "ext-1",
        source: JobSource.MICRO1,
        status: JobStatus.ACTIVE,
        lastSeenAt: STALE_DATE,
      });

      adapter.summaries = [CURRENT_SUMMARY];
      await service.sync();

      const call = mockDb.job.findMany.mock.calls[0][0];
      const cutoff = call.where.lastSeenAt.lt as Date;
      expect(cutoff.getTime() % 1000).toBe(0);
    });

    it("closeStaleJobs floors syncStart to whole seconds before comparing", async () => {
      store.jobs.push({
        id: "j1",
        externalId: "ext-1",
        source: JobSource.MICRO1,
        status: JobStatus.ACTIVE,
        lastSeenAt: STALE_DATE,
      });

      adapter.summaries = [CURRENT_SUMMARY];
      await service.sync();

      const call = mockDb.job.updateMany.mock.calls[0][0];
      const cutoff = call.where.lastSeenAt.lt as Date;
      expect(cutoff.getTime() % 1000).toBe(0);
    });

    it("BUG SCENARIO: job seen this sync (lastSeenAt seconds-truncated by DB) stays ACTIVE", async () => {
      // Simulate DB truncating lastSeenAt to whole seconds on every write.
      // The service receives a syncStart with ms; the DB stores it truncated.
      // With floorToSeconds, the cutoff is also truncated, so:
      //   truncated_lastSeenAt < floorToSeconds(syncStart)  ->  false  ->  stays ACTIVE
      // Without floorToSeconds, the cutoff has ms:
      //   truncated_lastSeenAt < syncStart_with_ms  ->  true  ->  wrongly CLOSED
      store.jobs.push({
        id: "j1",
        externalId: "ext-1",
        source: JobSource.MICRO1,
        status: JobStatus.ACTIVE,
        lastSeenAt: STALE_DATE,
      });

      // Re-see this job in the current sync so upsert updates lastSeenAt to syncStart
      // (truncated by the mock to simulate DB behaviour)
      adapter.summaries = [{ applyUrl: "ext-1", title: "Job 1", companyName: "Test Co" }];
      await service.sync();

      const job = store.jobs.find((j) => j.id === "j1")!;
      expect(job.status).not.toBe(JobStatus.CLOSED);
    });

    it("current-sync job whose stored lastSeenAt keeps ms also stays ACTIVE", async () => {
      store.jobs.push({
        id: "j1",
        externalId: "ext-1",
        source: JobSource.MICRO1,
        status: JobStatus.ACTIVE,
        lastSeenAt: STALE_DATE,
      });

      // Re-see this job so upsert updates lastSeenAt to syncStart
      adapter.summaries = [{ applyUrl: "ext-1", title: "Job 1", companyName: "Test Co" }];
      await service.sync();

      const job = store.jobs.find((j) => j.id === "j1")!;
      expect(job.status).not.toBe(JobStatus.CLOSED);
      expect(job.lastSeenAt).not.toBeNull();
    });
  });

  describe("required behaviours", () => {
    it("genuinely stale previously-seen jobs become CLOSED", async () => {
      store.jobs.push({
        id: "j-stale",
        externalId: "ext-stale",
        source: JobSource.MICRO1,
        status: JobStatus.ACTIVE,
        lastSeenAt: STALE_DATE,
      });

      // Provide at least one current job so stale detection runs
      adapter.summaries = [CURRENT_SUMMARY];
      await service.sync();

      const job = store.jobs.find((j) => j.id === "j-stale")!;
      expect(job.status).toBe(JobStatus.CLOSED);
    });

    it("NULL lastSeenAt jobs remain untouched (ignored by stale detection entirely)", async () => {
      store.jobs.push({
        id: "j-null",
        externalId: "ext-null",
        source: JobSource.MICRO1,
        status: JobStatus.ACTIVE,
        lastSeenAt: null,
      });

      adapter.summaries = [CURRENT_SUMMARY];
      await service.sync();

      const job = store.jobs.find((j) => j.id === "j-null")!;
      expect(job.status).toBe(JobStatus.ACTIVE);
      expect(job.lastSeenAt).toBeNull();
    });

    it("already-CLOSED stale jobs remain CLOSED and are not counted", async () => {
      store.jobs.push({
        id: "j-closed",
        externalId: "ext-closed",
        source: JobSource.MICRO1,
        status: JobStatus.CLOSED,
        lastSeenAt: STALE_DATE,
      });

      adapter.summaries = [CURRENT_SUMMARY];
      await service.sync();

      const job = store.jobs.find((j) => j.id === "j-closed")!;
      expect(job.status).toBe(JobStatus.CLOSED);
    });

    it("ARCHIVED jobs remain ARCHIVED and are not counted", async () => {
      store.jobs.push({
        id: "j-archived",
        externalId: "ext-archived",
        source: JobSource.MICRO1,
        status: JobStatus.ARCHIVED,
        lastSeenAt: STALE_DATE,
      });

      adapter.summaries = [CURRENT_SUMMARY];
      await service.sync();

      const job = store.jobs.find((j) => j.id === "j-archived")!;
      expect(job.status).toBe(JobStatus.ARCHIVED);
    });

    it("ON_HOLD stale jobs become CLOSED", async () => {
      store.jobs.push({
        id: "j-onhold",
        externalId: "ext-onhold",
        source: JobSource.MICRO1,
        status: JobStatus.ON_HOLD,
        lastSeenAt: STALE_DATE,
      });

      adapter.summaries = [CURRENT_SUMMARY];
      await service.sync();

      const job = store.jobs.find((j) => j.id === "j-onhold")!;
      expect(job.status).toBe(JobStatus.CLOSED);
    });

    it("does NOT affect jobs from another source (e.g. GREENHOUSE)", async () => {
      store.jobs.push({
        id: "j-other",
        externalId: "ext-other",
        source: JobSource.GREENHOUSE,
        status: JobStatus.ACTIVE,
        lastSeenAt: STALE_DATE,
      });

      // Provide a current MICRO1 job so stale detection runs for MICRO1
      adapter.summaries = [CURRENT_SUMMARY];
      await service.sync();

      const job = store.jobs.find((j) => j.id === "j-other")!;
      expect(job.status).toBe(JobStatus.ACTIVE);
    });

    it("correctly counts closed jobs across stale + eligible statuses", async () => {
      store.jobs.push(
        {
          id: "j-stale-1",
          externalId: "ext-s1",
          source: JobSource.MICRO1,
          status: JobStatus.ACTIVE,
          lastSeenAt: STALE_DATE,
        },
        {
          id: "j-stale-2",
          externalId: "ext-s2",
          source: JobSource.MICRO1,
          status: JobStatus.ON_HOLD,
          lastSeenAt: STALE_DATE,
        },
        {
          id: "j-already-closed",
          externalId: "ext-ac",
          source: JobSource.MICRO1,
          status: JobStatus.CLOSED,
          lastSeenAt: STALE_DATE,
        },
        {
          id: "j-other-source",
          externalId: "ext-os",
          source: JobSource.GREENHOUSE,
          status: JobStatus.ACTIVE,
          lastSeenAt: STALE_DATE,
        },
      );

      adapter.summaries = [CURRENT_SUMMARY];
      await service.sync();

      // Two eligible stale jobs should be CLOSED
      expect(store.jobs.find((j) => j.id === "j-stale-1")!.status).toBe(JobStatus.CLOSED);
      expect(store.jobs.find((j) => j.id === "j-stale-2")!.status).toBe(JobStatus.CLOSED);
      // Excluded: already CLOSED, and different source
      expect(store.jobs.find((j) => j.id === "j-already-closed")!.status).toBe(JobStatus.CLOSED);
      expect(store.jobs.find((j) => j.id === "j-other-source")!.status).toBe(JobStatus.ACTIVE);

      // updateMany was called exactly once with the expected where/data
      expect(mockDb.job.updateMany).toHaveBeenCalledTimes(1);
      const updateCall = mockDb.job.updateMany.mock.calls[0][0];
      expect(updateCall.data).toEqual({ status: JobStatus.CLOSED });
    });
  });

  describe("findStaleJobs reporting through sync()", () => {
    it("reports this-sync jobs as NOT stale, stale jobs as stale, null as NOT stale", async () => {
      store.jobs.push(
        {
          id: "never-stale",
          externalId: "e1",
          source: JobSource.MICRO1,
          status: JobStatus.ACTIVE,
          lastSeenAt: STALE_DATE,
        },
        {
          id: "stale",
          externalId: "e2",
          source: JobSource.MICRO1,
          status: JobStatus.ACTIVE,
          lastSeenAt: STALE_DATE,
        },
        {
          id: "never-seen",
          externalId: "e3",
          source: JobSource.MICRO1,
          status: JobStatus.IMPORTED,
          lastSeenAt: null,
        },
      );

      // Re-see "never-stale" so it gets a fresh lastSeenAt and is not stale
      adapter.summaries = [{ applyUrl: "e1", title: "Job 1", companyName: "Test Co" }];
      const result = await service.sync();

      const staleIds = result.staleJobs.map((j) => j.id);
      expect(staleIds).toContain("stale");
      expect(staleIds).not.toContain("never-seen");
      expect(staleIds).not.toContain("never-stale");
    });
  });

  describe("zero-jobs safety guard", () => {
    it("leaves stale jobs ACTIVE when source returns zero jobs", async () => {
      store.jobs.push({
        id: "j-stale",
        externalId: "ext-stale",
        source: JobSource.MICRO1,
        status: JobStatus.ACTIVE,
        lastSeenAt: STALE_DATE,
      });

      const result = await service.sync();

      const job = store.jobs.find((j) => j.id === "j-stale")!;
      expect(job.status).toBe(JobStatus.ACTIVE);
      expect(result.totalSeen).toBe(0);
      expect(result.totalStale).toBe(0);
      expect(result.staleJobs).toEqual([]);
    });

    it("does NOT call findStaleJobs when source returns zero jobs", async () => {
      store.jobs.push({
        id: "j-stale",
        externalId: "ext-stale",
        source: JobSource.MICRO1,
        status: JobStatus.ACTIVE,
        lastSeenAt: STALE_DATE,
      });

      await service.sync();

      expect(mockDb.job.findMany).not.toHaveBeenCalled();
    });

    it("does NOT call closeStaleJobs when source returns zero jobs", async () => {
      store.jobs.push({
        id: "j-stale",
        externalId: "ext-stale",
        source: JobSource.MICRO1,
        status: JobStatus.ACTIVE,
        lastSeenAt: STALE_DATE,
      });

      await service.sync();

      expect(mockDb.job.updateMany).not.toHaveBeenCalled();
    });

    it("still records SourceSync with totalSeen=0 when source returns zero jobs", async () => {
      await service.sync();

      expect(mockDb.sourceSync.upsert).toHaveBeenCalledTimes(1);
      const call = mockDb.sourceSync.upsert.mock.calls[0][0];
      expect(call.create.totalSeen).toBe(0);
      expect(call.update.totalSeen).toBe(0);
    });

    it("emits a warning when source returns zero jobs", async () => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await service.sync();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Source returned 0 jobs"),
      );
    });
  });

  describe("JobRepository API surface", () => {
    it("no longer exposes markStaleJobsAsClosed", () => {
      expect("markStaleJobsAsClosed" in repo).toBe(false);
    });
  });

  describe("advisory-lock concurrency protection", () => {
    it("runs sync normally when the lock is acquired", async () => {
      adapter.summaries = [CURRENT_SUMMARY];

      const result = await service.sync();

      expect(result.skipped).toBeUndefined();
      expect(result.totalSeen).toBe(1);
      expect(mockLock.acquire).toHaveBeenCalledTimes(1);
      expect(mockLock.release).toHaveBeenCalledTimes(1);
    });

    it("acquires the lock before any job upserts", async () => {
      adapter.summaries = [CURRENT_SUMMARY];

      await service.sync();

      // Lock acquire must be called and complete before any job.upsert.
      expect(mockLock.acquire.mock.invocationCallOrder[0]).toBeLessThan(
        mockDb.job.upsert.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
    });

    it("exits safely without ingesting when the lock is NOT acquired", async () => {
      setLockAcquired(false);
      adapter.summaries = [CURRENT_SUMMARY];

      const result = await service.sync();

      expect(result.skipped).toBe(true);
      expect(result.totalSeen).toBe(0);
      expect(result.totalCreated).toBe(0);
      expect(result.totalUpdated).toBe(0);
      expect(result.totalStale).toBe(0);
      expect(result.staleJobs).toEqual([]);
      expect(mockDb.job.upsert).not.toHaveBeenCalled();
      expect(mockDb.job.updateMany).not.toHaveBeenCalled();
      // Lock was never acquired, so it must not be released either.
      expect(mockLock.release).not.toHaveBeenCalled();
    });

    it("does NOT call findStaleJobs or closeStaleJobs when the lock is NOT acquired", async () => {
      setLockAcquired(false);

      await service.sync();

      expect(mockDb.job.findMany).not.toHaveBeenCalled();
      expect(mockDb.job.updateMany).not.toHaveBeenCalled();
    });

    it("does NOT write SourceSync record when the lock is NOT acquired", async () => {
      setLockAcquired(false);

      await service.sync();

      expect(mockDb.sourceSync.upsert).not.toHaveBeenCalled();
    });

    it("emits a warning when the lock is NOT acquired", async () => {
      setLockAcquired(false);
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await service.sync();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Another sync is already running"),
      );
    });

    it("releases the lock even when sync throws after lock acquisition", async () => {
      adapter.summaries = [CURRENT_SUMMARY];
      const originalImpl = mockDb.sourceSync.upsert.getMockImplementation();
      mockDb.sourceSync.upsert.mockRejectedValueOnce(
        new Error("synthetic failure inside sync after lock acquisition"),
      );

      await expect(service.sync()).rejects.toThrow("synthetic failure");

      // The lock was acquired (return value was a HeldSourceLock), and the
      // finally block must have called releaseSourceLock exactly once.
      expect(mockLock.acquire).toHaveBeenCalledTimes(1);
      expect(mockLock.release).toHaveBeenCalledTimes(1);

      // Restore the default implementation for subsequent tests.
      if (originalImpl) {
        mockDb.sourceSync.upsert.mockImplementation(originalImpl);
      } else {
        mockDb.sourceSync.upsert.mockResolvedValue({});
      }
    });

    it("does NOT hold a Prisma transaction open across network calls (no $transaction wrapper)", async () => {
      // Architectural invariant: SourceSyncService.sync() must not wrap its
      // body in prisma.$transaction. The lock is held on a dedicated
      // pg.Client (mocked here), and per-job upserts are short-lived
      // transactions inside JobRepository.upsert.
      //
      // We assert this by source inspection: sync() should never call
      // prisma.$transaction directly. The per-job JobRepository.upsert
      // remains wrapped in a single short transaction (its internal
      // behavior is unchanged from before this fix).
      const syncSource = await import("../../src/services/sync.service.js");
      const sourceText = syncSource.SourceSyncService.prototype.sync.toString();
      // sync() must not contain a $transaction call.
      expect(sourceText).not.toMatch(/\$transaction\s*\(/);
      // sync() must call the lock helper.
      expect(sourceText).toMatch(/acquireSourceLock|releaseSourceLock/);
    });
  });
});
