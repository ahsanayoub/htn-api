import { afterEach, describe, expect, it, vi } from "vitest";
import { JobSource, JobStatus } from "@prisma/client";

import { Micro1SyncAdapter } from "../../src/adapters/micro1.adapter.js";
import {
  shouldCloseJobsAbsentFromFeed,
  type SourceAdapter,
} from "../../src/adapters/source.adapter.js";
import type { Micro1Client } from "../../src/clients/micro1.client.js";
import type { Micro1Processor } from "../../src/processors/micro1.processor.js";
import type { JobUpsertData } from "../../src/repositories/job.repository.js";
import {
  eligibilityCreateData,
  evaluateEligibleSnapshot,
  planMicro1ReferralEligibility,
  reconcileMicro1ReferralEligibility,
  type Micro1EligibilityJob,
} from "../../src/services/micro1-referral-eligibility.js";
import {
  captureReferralInventory,
  type ReferralInventoryCapture,
  type ReferralInventoryFetcher,
} from "../../src/services/micro1-referral-inventory.js";

const ORIGINAL_DISCOVERY = process.env.MICRO1_DISCOVERY_SOURCE;

afterEach(() => {
  if (ORIGINAL_DISCOVERY === undefined) delete process.env.MICRO1_DISCOVERY_SOURCE;
  else process.env.MICRO1_DISCOVERY_SOURCE = ORIGINAL_DISCOVERY;
});

function capture(overrides: Partial<ReferralInventoryCapture> = {}): ReferralInventoryCapture {
  return {
    capturedAt: "2026-10-14T00:00:00.000Z",
    request: { method: "GET", path: "/referral/portal/eligible-jobs", pageLimit: 100 },
    reportedTotal: 1,
    pages: [{ page: 1, rowCount: 1, reportedTotal: 1 }],
    pagesFetched: 1,
    rawCount: 1,
    uniqueCount: 1,
    duplicateIds: [],
    invalidRows: [],
    failures: [],
    inventoryComplete: true,
    completionNotes: ["eligible-jobs pagination matched the reported total"],
    jobs: [
      {
        jobId: "job-present",
        referralShapeConflict: false,
        referralUrl: {
          hostIsJobsMicro1: true,
          pathContainsJobId: true,
          hasReferralCodeParam: true,
          structurallyValid: true,
          redactedShape: "https://jobs.micro1.ai/post/{jobId}?referralCode",
        },
      },
    ],
    ...overrides,
  };
}

function job(partial: Partial<Micro1EligibilityJob> & Pick<Micro1EligibilityJob, "id" | "externalId" | "status">): Micro1EligibilityJob {
  return {
    source: JobSource.MICRO1,
    ...partial,
  };
}

function page(total: number, rows: unknown[]) {
  return { status: true, statusCode: 200, message: "ok", total, data: rows };
}

describe("evaluateEligibleSnapshot", () => {
  it("rejects an API failure before any absence decision", async () => {
    const fetchPage: ReferralInventoryFetcher = async () => {
      throw new Error("Micro1 referral authentication failed");
    };
    const result = evaluateEligibleSnapshot(await captureReferralInventory(fetchPage));
    expect(result).toEqual({ ok: false, reason: "request_failed" });
  });

  it("rejects an invalid total", async () => {
    const result = evaluateEligibleSnapshot(
      await captureReferralInventory(async () => ({ status: true, data: [], total: "nope" })),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_total" });
  });

  it("rejects incomplete pagination", async () => {
    const result = evaluateEligibleSnapshot(
      await captureReferralInventory(async () => page(5, [{ job_id: "only-one", apply_url: "https://jobs.micro1.ai/post/only-one?referralCode=x" }])),
    );
    expect(result).toEqual({ ok: false, reason: "incomplete_pagination" });
  });

  it("rejects a row without a job id", async () => {
    const result = evaluateEligibleSnapshot(
      await captureReferralInventory(async () => page(1, [{ job_name: "Missing id" }])),
    );
    expect(result).toEqual({ ok: false, reason: "missing_job_id" });
  });

  it("rejects duplicate job ids", async () => {
    const row = { job_id: "dup", apply_url: "https://jobs.micro1.ai/post/dup?referralCode=x" };
    const result = evaluateEligibleSnapshot(
      await captureReferralInventory(async () => page(2, [row, row])),
    );
    expect(result).toEqual({ ok: false, reason: "duplicate_ids" });
  });

  it("rejects an empty but otherwise complete feed", () => {
    const result = evaluateEligibleSnapshot(capture({
      reportedTotal: 0,
      rawCount: 0,
      uniqueCount: 0,
      jobs: [],
      pages: [{ page: 1, rowCount: 0, reportedTotal: 0 }],
    }));
    expect(result).toEqual({ ok: false, reason: "empty_snapshot" });
  });

  it("accepts a complete non-empty snapshot", () => {
    expect(evaluateEligibleSnapshot(capture()).ok).toBe(true);
  });
});

describe("planMicro1ReferralEligibility", () => {
  const eligible = new Set(["present", "returning", "brand-new"]);

  const existing = [
    job({ id: "active-missing", externalId: "departed", status: JobStatus.ACTIVE }),
    job({ id: "closed-returning", externalId: "returning", status: JobStatus.CLOSED }),
    job({ id: "already-active", externalId: "present", status: JobStatus.ACTIVE }),
    job({ id: "closed-stays", externalId: "already-closed", status: JobStatus.CLOSED }),
    job({ id: "other-source", externalId: "departed", status: JobStatus.ACTIVE, source: JobSource.GREENHOUSE }),
  ];

  it("closes a missing active Micro1 job, reopens the same id, and creates a new id", () => {
    const plan = planMicro1ReferralEligibility(eligible, existing);
    expect(plan.close).toEqual([
      { id: "active-missing", externalId: "departed", fromStatus: JobStatus.ACTIVE, toStatus: JobStatus.CLOSED },
    ]);
    expect(plan.reopen).toEqual([
      { id: "closed-returning", externalId: "returning", fromStatus: JobStatus.CLOSED, toStatus: JobStatus.ACTIVE },
    ]);
    expect(plan.create).toEqual(["brand-new"]);
  });

  it("does not change another source", () => {
    const plan = planMicro1ReferralEligibility(new Set<string>(), [
      job({ id: "other-source", externalId: "departed", status: JobStatus.ACTIVE, source: JobSource.MANUAL }),
    ]);
    expect(plan.close).toEqual([]);
    expect(plan.reopen).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it("is idempotent after the planned status changes", () => {
    const first = planMicro1ReferralEligibility(eligible, existing);
    const after = existing.map((row) => {
      const closed = first.close.find((change) => change.id === row.id);
      if (closed) return { ...row, status: JobStatus.CLOSED };
      const reopened = first.reopen.find((change) => change.id === row.id);
      if (reopened) return { ...row, status: JobStatus.ACTIVE };
      return row;
    });
    const created = [
      ...after,
      job({ id: "created-1", externalId: "brand-new", status: JobStatus.ACTIVE }),
    ];
    const second = planMicro1ReferralEligibility(eligible, created);
    expect(second).toEqual({ create: [], close: [], reopen: [] });
  });
});

describe("eligibilityCreateData", () => {
  it("creates through the existing upsert payload as an active Micro1 job", () => {
    const prepared = eligibilityCreateData(
      {
        externalId: "from-page",
        source: JobSource.MICRO1,
        title: "Engineer",
        organizationId: "org-1",
        referralUrl: "https://jobs.micro1.ai/post/brand-new?referralCode=secret",
        status: JobStatus.CLOSED,
      } as JobUpsertData,
      "brand-new",
    );
    expect(prepared.externalId).toBe("brand-new");
    expect(prepared.source).toBe(JobSource.MICRO1);
    expect(prepared.status).toBe(JobStatus.ACTIVE);
    expect(prepared.preserveStatusOnUpdate).toBe(true);
    expect(prepared.referralUrl).toContain("referralCode=secret");
  });
});

describe("reconcileMicro1ReferralEligibility", () => {
  function harness(snapshot: ReferralInventoryCapture, existing: Micro1EligibilityJob[]) {
    const setStatus = vi.fn(async () => undefined);
    const createJob = vi.fn(async () => undefined);
    const loadSnapshot = vi.fn(async () => snapshot);
    return {
      setStatus,
      createJob,
      loadSnapshot,
      run: (dryRun: boolean, referralDiscovery = true) =>
        reconcileMicro1ReferralEligibility({
          dryRun,
          referralDiscovery,
          loadSnapshot,
          listJobs: async () => existing,
          setStatus,
          createJob,
          acquireLock: async () => true,
          releaseLock: async () => undefined,
        }),
    };
  }

  const existing = [
    job({ id: "active-missing", externalId: "departed", status: JobStatus.ACTIVE }),
    job({ id: "closed-returning", externalId: "job-present", status: JobStatus.CLOSED }),
    job({ id: "other", externalId: "job-present", status: JobStatus.ACTIVE, source: JobSource.MANUAL }),
  ];

  it("does not write when the snapshot is rejected", async () => {
    const rejected = capture({ failures: [{ page: 1, message: "Micro1 referral authentication failed" }] });
    const { run, setStatus, createJob } = harness(rejected, existing);
    const report = await run(false);
    expect(report.applied).toBe(false);
    expect(report.reason).toBe("request_failed");
    expect(setStatus).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("does not write in dry-run mode", async () => {
    const { run, setStatus, createJob } = harness(capture(), existing);
    const report = await run(true);
    expect(report.applied).toBe(false);
    expect(report.dryRun).toBe(true);
    expect(report.close.map((change) => change.externalId)).toEqual(["departed"]);
    expect(report.reopen.map((change) => change.externalId)).toEqual(["job-present"]);
    expect(setStatus).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("applies close, reopen, and create, and skips other sources", async () => {
    const snapshot = capture({
      reportedTotal: 2,
      rawCount: 2,
      uniqueCount: 2,
      jobs: [
        capture().jobs[0],
        {
          ...capture().jobs[0],
          jobId: "brand-new",
        },
      ],
    });
    const { run, setStatus, createJob } = harness(snapshot, existing);
    const report = await run(false);
    expect(report.applied).toBe(true);
    expect(setStatus).toHaveBeenCalledWith("closed-returning", JobStatus.ACTIVE);
    expect(setStatus).toHaveBeenCalledWith("active-missing", JobStatus.CLOSED);
    expect(setStatus).not.toHaveBeenCalledWith("other", expect.anything());
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(createJob).toHaveBeenCalledWith("brand-new");
  });

  it("does not load the feed when discovery is not referral", async () => {
    const { run, loadSnapshot, setStatus } = harness(capture(), existing);
    const report = await run(false, false);
    expect(report.reason).toBe("not_referral_discovery");
    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("does not load the feed when another reconciliation holds the lock", async () => {
    const loadSnapshot = vi.fn();
    const setStatus = vi.fn();
    const report = await reconcileMicro1ReferralEligibility({
      dryRun: false,
      referralDiscovery: true,
      loadSnapshot,
      listJobs: async () => [],
      setStatus,
      createJob: async () => undefined,
      acquireLock: async () => false,
    });
    expect(report.reason).toBe("reconciliation_already_running");
    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });
});

describe("shared stale closure", () => {
  it("still refuses Micro1 absence closure and keeps it for other sources", () => {
    process.env.MICRO1_DISCOVERY_SOURCE = "referral";
    const micro1 = new Micro1SyncAdapter({} as Micro1Client, {} as Micro1Processor);
    expect(micro1.closesJobsAbsentFromFeed()).toBe(false);
    expect(shouldCloseJobsAbsentFromFeed(micro1)).toBe(false);
    expect(shouldCloseJobsAbsentFromFeed({ source: JobSource.GREENHOUSE } as SourceAdapter)).toBe(true);
  });
});
