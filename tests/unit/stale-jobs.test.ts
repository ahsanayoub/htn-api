import { describe, it, expect, vi, beforeEach } from "vitest";
import { JobSource, JobStatus } from "@prisma/client";
import { JobRepository } from "../../src/repositories/job.repository.js";

// These tests reproduce the Step 6B precision bug WITHOUT a database.
// They use an in-memory store that faithfully simulates the subset of SQL
// semantics used by `findStaleJobs` / `markStaleJobsAsClosed` so the behaviour
// ("seen this sync stays ACTIVE", "stale becomes CLOSED", etc.) can be
// asserted directly and runs in any environment.

interface FakeJob {
  id: string;
  externalId: string | null;
  source: JobSource;
  status: JobStatus;
  lastSeenAt: Date | null;
}

type WhereClause = Record<string, unknown>;

const { mockJob, store } = vi.hoisted(() => {
  const jobs: FakeJob[] = [];

  function matches(job: FakeJob, where: WhereClause): boolean {
    if (!where) return true;
    if (where.OR) {
      return (where.OR as WhereClause[]).some(
        (cond) => matches(job, cond),
      );
    }
    if (where.source !== undefined && job.source !== where.source) return false;

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

  function pick(job: FakeJob, select: Record<string, boolean>) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(select)) {
      out[k] = (job as Record<string, unknown>)[k];
    }
    return out;
  }

  const job = {
    findMany: vi.fn(
      async (args: {
        where: WhereClause;
        select?: Record<string, boolean>;
      }) => {
        const filtered = jobs.filter((job) => matches(job, args.where));
        return args.select
          ? filtered.map((job) => pick(job, args.select))
          : filtered;
      },
    ),
    updateMany: vi.fn(
      async (args: { where: WhereClause; data: Partial<FakeJob> }) => {
        let count = 0;
        for (const job of jobs) {
          if (matches(job, args.where)) {
            Object.assign(job, args.data);
            count++;
          }
        }
        return { count };
      },
    ),
  };

  return { mockJob: job, store: jobs };
});

vi.mock("../../src/prisma/client.js", () => ({
  __esModule: true,
  default: { job: mockJob },
}));

const repo = new JobRepository();

describe("JobRepository stale-job detection", () => {
  // syncStart as captured by SourceSyncService.sync(): new Date() -> carries ms.
  const SYNC_START = new Date("2026-08-14T20:27:47.797Z");
  // The cutoff the DB must see: floored to whole seconds.
  const FLOORED_CUTOFF = new Date("2026-08-14T20:27:47.000Z");

  beforeEach(() => {
    store.length = 0;
    mockJob.findMany.mockClear();
    mockJob.updateMany.mockClear();
  });

  describe("regression: timestamp precision bug (Step 6B)", () => {
    it("floors syncStart to whole seconds before comparing", async () => {
      await repo.findStaleJobs(JobSource.MICRO1, SYNC_START);

      const call = mockJob.findMany.mock.calls[0][0];
      // The cutoff passed to the DB must be second-aligned, NOT the raw ms value.
      expect(call.where.OR[0].lastSeenAt.lt).toEqual(FLOORED_CUTOFF);
      expect(call.where.OR[0].lastSeenAt.lt).not.toEqual(SYNC_START);
    });

    it("markStaleJobsAsClosed floors syncStart to whole seconds before comparing", async () => {
      await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);

      const call = mockJob.updateMany.mock.calls[0][0];
      expect(call.where.lastSeenAt.lt).toEqual(FLOORED_CUTOFF);
      expect(call.where.lastSeenAt.lt).not.toEqual(SYNC_START);
    });

    it("BUG SCENARIO: job seen this sync (lastSeenAt seconds-truncated by DB) stays ACTIVE", async () => {
      // Production behaviour: syncStart=20:27:47.797, but the DB stored
      // lastSeenAt as 20:27:47.000 (ms dropped). A naive `lastSeenAt < syncStart`
      // is TRUE here and wrongly closes the job. After the fix the cutoff is
      // floored to 20:27:47.000, so `20:27:47.000 < 20:27:47.000` is false.
      store.push({
        id: "job-current-sync",
        externalId: "external-current",
        source: JobSource.MICRO1,
        status: JobStatus.ACTIVE,
        lastSeenAt: new Date("2026-08-14T20:27:47.000Z"),
      });

      const closed = await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);

      expect(closed).toBe(0);
      expect(store[0].status).toBe(JobStatus.ACTIVE);
    });

    it("current-sync job whose stored lastSeenAt keeps ms also stays ACTIVE", async () => {
      store.push({
        id: "job-current-ms",
        externalId: "external-current-ms",
        source: JobSource.MICRO1,
        status: JobStatus.ACTIVE,
        lastSeenAt: SYNC_START,
      });

      const closed = await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);

      expect(closed).toBe(0);
      expect(store[0].status).toBe(JobStatus.ACTIVE);
    });
  });

  describe("required behaviours", () => {
    it("genuinely stale previously-seen jobs become CLOSED", async () => {
      store.push({
        id: "job-stale",
        externalId: "external-stale",
        source: JobSource.MICRO1,
        status: JobStatus.ACTIVE,
        lastSeenAt: new Date("2026-08-14T10:00:00.000Z"),
      });

      const closed = await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);

      expect(closed).toBe(1);
      expect(store[0].status).toBe(JobStatus.CLOSED);
    });

    it("NULL lastSeenAt (legacy) jobs remain untouched", async () => {
      store.push({
        id: "job-null",
        externalId: "external-null",
        source: JobSource.MICRO1,
        status: JobStatus.ACTIVE,
        lastSeenAt: null,
      });

      const closed = await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);

      expect(closed).toBe(0);
      expect(store[0].status).toBe(JobStatus.ACTIVE);
      expect(store[0].lastSeenAt).toBeNull();
    });

    it("already-CLOSED stale jobs remain CLOSED and are not counted", async () => {
      store.push({
        id: "job-closed",
        externalId: "external-closed",
        source: JobSource.MICRO1,
        status: JobStatus.CLOSED,
        lastSeenAt: new Date("2026-08-10T00:00:00.000Z"),
      });

      const closed = await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);

      expect(closed).toBe(0);
      expect(store[0].status).toBe(JobStatus.CLOSED);
    });

    it("ARCHIVED jobs remain ARCHIVED and are not counted", async () => {
      store.push({
        id: "job-archived",
        externalId: "external-archived",
        source: JobSource.MICRO1,
        status: JobStatus.ARCHIVED,
        lastSeenAt: new Date("2026-08-10T00:00:00.000Z"),
      });

      const closed = await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);

      expect(closed).toBe(0);
      expect(store[0].status).toBe(JobStatus.ARCHIVED);
    });

    it("ON_HOLD stale jobs become CLOSED", async () => {
      store.push({
        id: "job-onhold",
        externalId: "external-onhold",
        source: JobSource.MICRO1,
        status: JobStatus.ON_HOLD,
        lastSeenAt: new Date("2026-08-10T00:00:00.000Z"),
      });

      const closed = await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);

      expect(closed).toBe(1);
      expect(store[0].status).toBe(JobStatus.CLOSED);
    });

    it("does NOT affect jobs from another source", async () => {
      store.push({
        id: "job-other-source",
        externalId: "external-other",
        source: JobSource.GREENHOUSE,
        status: JobStatus.ACTIVE,
        lastSeenAt: new Date("2026-08-10T00:00:00.000Z"),
      });

      const closed = await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);

      expect(closed).toBe(0);
      expect(store[0].status).toBe(JobStatus.ACTIVE);
    });

    it("findStaleJobs reports this-sync jobs as NOT stale, stale jobs as stale, null as candidate", async () => {
      store.push(
        {
          id: "this-sync",
          externalId: "e1",
          source: JobSource.MICRO1,
          status: JobStatus.ACTIVE,
          lastSeenAt: new Date("2026-08-14T20:27:47.000Z"),
        },
        {
          id: "stale",
          externalId: "e2",
          source: JobSource.MICRO1,
          status: JobStatus.ACTIVE,
          lastSeenAt: new Date("2026-08-14T10:00:00.000Z"),
        },
        {
          id: "never-seen",
          externalId: "e3",
          source: JobSource.MICRO1,
          status: JobStatus.IMPORTED,
          lastSeenAt: null,
        },
      );

      const stale = await repo.findStaleJobs(JobSource.MICRO1, SYNC_START);
      const staleIds = stale.map((j) => j.id);

      expect(staleIds).toContain("stale");
      expect(staleIds).toContain("never-seen");
      // The job seen during THIS sync must never be reported as stale.
      expect(staleIds).not.toContain("this-sync");
    });
  });
});
