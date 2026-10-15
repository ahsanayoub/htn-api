import { afterEach, describe, expect, it, vi } from "vitest";
import { JobSource, JobStatus } from "@prisma/client";

import { Micro1SyncAdapter } from "../../src/adapters/micro1.adapter.js";
import {
  shouldCloseJobsAbsentFromFeed,
  type SourceAdapter,
} from "../../src/adapters/source.adapter.js";
import type { Micro1Client } from "../../src/clients/micro1.client.js";
import type { Micro1Processor } from "../../src/processors/micro1.processor.js";
import type { DbTransaction, JobUpsertData } from "../../src/repositories/job.repository.js";
import {
  eligibilityCreateData,
  evaluateEligibleSnapshot,
  planMicro1ReferralEligibility,
  reconcileMicro1ReferralEligibility,
  type Micro1EligibilityJob,
  type PreparedEligibilityCreate,
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

type MemoryState = {
  jobs: Array<{
    id: string;
    externalId: string | null;
    source: JobSource;
    status: JobStatus;
    title?: string;
    organizationId?: string;
  }>;
  orgs: Array<{ id: string; name: string }>;
  skills: Array<{ id: string; name: string }>;
  jobSkills: Array<{ jobId: string; skillId: string }>;
};

function seedState(existing: Micro1EligibilityJob[]): MemoryState {
  return {
    jobs: existing.map((row) => ({ ...row })),
    orgs: [],
    skills: [],
    jobSkills: [],
  };
}

function memoryTransaction(state: MemoryState, failOn?: "skill") {
  let sequence = 1;
  const tx = {
    organization: {
      findFirst: async ({ where }: { where: { name: string } }) =>
        state.orgs.find((org) => org.name === where.name) ?? null,
      create: async ({ data }: { data: { name: string } }) => {
        const row = { id: `org-${sequence++}`, name: data.name };
        state.orgs.push(row);
        return row;
      },
    },
    job: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; source: JobSource };
        data: { status: JobStatus };
      }) => {
        let count = 0;
        for (const row of state.jobs) {
          if (row.id === where.id && row.source === where.source) {
            row.status = data.status;
            count += 1;
          }
        }
        return { count };
      },
      findFirst: async ({
        where,
      }: {
        where: { source: JobSource; externalId: string };
      }) =>
        state.jobs.find(
          (row) => row.source === where.source && row.externalId === where.externalId,
        ) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { source_externalId: { source: JobSource; externalId: string } };
        create: {
          externalId: string;
          source: JobSource;
          title: string;
          status: JobStatus;
          organization: { connect: { id: string } };
        };
        update: { title?: string; status?: JobStatus };
      }) => {
        const key = where.source_externalId;
        const existingRow = state.jobs.find(
          (row) => row.source === key.source && row.externalId === key.externalId,
        );
        if (existingRow) {
          existingRow.title = update.title;
          if (update.status !== undefined) existingRow.status = update.status;
          return existingRow;
        }
        const created = {
          id: `job-${sequence++}`,
          externalId: create.externalId,
          source: create.source,
          status: create.status,
          title: create.title,
          organizationId: create.organization.connect.id,
        };
        state.jobs.push(created);
        return created;
      },
    },
    skill: {
      findMany: async ({ where }: { where: { name: { in: string[] } } }) =>
        state.skills.filter((skill) =>
          where.name.in.some((name) => name.toLowerCase() === skill.name.toLowerCase()),
        ),
      createMany: async ({ data }: { data: Array<{ name: string }> }) => {
        if (failOn === "skill") throw new Error("simulated skill write failure");
        for (const row of data) state.skills.push({ id: `skill-${sequence++}`, name: row.name });
        return { count: data.length };
      },
    },
    jobSkill: {
      createMany: async ({ data }: { data: Array<{ jobId: string; skillId: string }> }) => {
        state.jobSkills.push(...data);
        return { count: data.length };
      },
    },
  };
  return tx as unknown as DbTransaction;
}

function preparedCreate(externalId: string): PreparedEligibilityCreate {
  return {
    externalId,
    organizationName: "Acme",
    data: {
      externalId,
      source: JobSource.MICRO1,
      title: "New role",
      organizationId: "placeholder",
      status: JobStatus.CLOSED,
      skillNames: ["Go"],
      referralUrl: "https://jobs.micro1.ai/post/new?referralCode=rc",
    },
  };
}

describe("reconcileMicro1ReferralEligibility", () => {
  function harness(
    snapshot: ReferralInventoryCapture,
    existing: Micro1EligibilityJob[],
    options?: { failOn?: "skill"; prepareError?: Error },
  ) {
    const committed = seedState(existing);
    const prepareCreates = vi.fn(async (externalIds: readonly string[]) => {
      if (options?.prepareError) throw options.prepareError;
      return externalIds.map((externalId) => preparedCreate(externalId));
    });
    const runTransaction = vi.fn(async (work: (tx: DbTransaction) => Promise<void>) => {
      const draft = structuredClone(committed);
      await work(memoryTransaction(draft, options?.failOn));
      committed.jobs = draft.jobs;
      committed.orgs = draft.orgs;
      committed.skills = draft.skills;
      committed.jobSkills = draft.jobSkills;
    });
    const loadSnapshot = vi.fn(async () => snapshot);
    return {
      committed,
      prepareCreates,
      runTransaction,
      loadSnapshot,
      run: (dryRun: boolean, referralDiscovery = true) =>
        reconcileMicro1ReferralEligibility({
          dryRun,
          referralDiscovery,
          loadSnapshot,
          listJobs: async () => existing,
          prepareCreates,
          runTransaction,
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
    const { run, prepareCreates, runTransaction } = harness(rejected, existing);
    const report = await run(false);
    expect(report.applied).toBe(false);
    expect(report.reason).toBe("request_failed");
    expect(prepareCreates).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("does not write in dry-run mode", async () => {
    const { run, prepareCreates, runTransaction } = harness(capture(), existing);
    const report = await run(true);
    expect(report.applied).toBe(false);
    expect(report.dryRun).toBe(true);
    expect(report.close.map((change) => change.externalId)).toEqual(["departed"]);
    expect(report.reopen.map((change) => change.externalId)).toEqual(["job-present"]);
    expect(prepareCreates).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
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
    const { run, committed, prepareCreates, runTransaction } = harness(snapshot, existing);
    const report = await run(false);
    expect(report.applied).toBe(true);
    expect(prepareCreates).toHaveBeenCalledWith(["brand-new"]);
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(committed.jobs.find((row) => row.id === "closed-returning")?.status).toBe(JobStatus.ACTIVE);
    expect(committed.jobs.find((row) => row.id === "active-missing")?.status).toBe(JobStatus.CLOSED);
    expect(committed.jobs.find((row) => row.id === "other")?.status).toBe(JobStatus.ACTIVE);
    expect(committed.jobs.find((row) => row.externalId === "brand-new")).toMatchObject({
      source: JobSource.MICRO1,
      status: JobStatus.ACTIVE,
      organizationId: "org-1",
    });
    expect(committed.orgs).toEqual([{ id: "org-1", name: "Acme" }]);
    expect(committed.skills.map((skill) => skill.name)).toEqual(["Go"]);
    expect(committed.jobSkills).toEqual([
      {
        jobId: committed.jobs.find((row) => row.externalId === "brand-new")?.id,
        skillId: committed.skills[0]?.id,
      },
    ]);
  });

  it("prepares new jobs before opening the transaction", async () => {
    const order: string[] = [];
    const report = await reconcileMicro1ReferralEligibility({
      dryRun: false,
      referralDiscovery: true,
      loadSnapshot: async () => capture(),
      listJobs: async () => existing,
      prepareCreates: async () => {
        order.push("prepare");
        return [];
      },
      runTransaction: async (work) => {
        order.push("transaction");
        await work(memoryTransaction(seedState(existing)));
      },
      acquireLock: async () => true,
      releaseLock: async () => undefined,
    });
    expect(report.applied).toBe(true);
    expect(order).toEqual(["prepare", "transaction"]);
  });

  it("does not open a transaction when job preparation fails", async () => {
    const { run, runTransaction, committed } = harness(capture(), existing, {
      prepareError: new Error("detail fetch failed"),
    });
    await expect(run(false)).rejects.toThrow("detail fetch failed");
    expect(runTransaction).not.toHaveBeenCalled();
    expect(committed.jobs.find((row) => row.id === "active-missing")?.status).toBe(JobStatus.ACTIVE);
    expect(committed.orgs).toEqual([]);
  });

  it("rolls back status, organization, job, and skill writes when a later write fails", async () => {
    const snapshot = capture({
      reportedTotal: 2,
      rawCount: 2,
      uniqueCount: 2,
      jobs: [
        capture().jobs[0],
        { ...capture().jobs[0], jobId: "brand-new" },
      ],
    });
    const { run, committed } = harness(snapshot, existing, { failOn: "skill" });
    await expect(run(false)).rejects.toThrow("simulated skill write failure");
    expect(committed.jobs.find((row) => row.id === "closed-returning")?.status).toBe(JobStatus.CLOSED);
    expect(committed.jobs.find((row) => row.id === "active-missing")?.status).toBe(JobStatus.ACTIVE);
    expect(committed.jobs.some((row) => row.externalId === "brand-new")).toBe(false);
    expect(committed.orgs).toEqual([]);
    expect(committed.skills).toEqual([]);
    expect(committed.jobSkills).toEqual([]);
  });

  it("does not load the feed when discovery is not referral", async () => {
    const { run, loadSnapshot, prepareCreates, runTransaction } = harness(capture(), existing);
    const report = await run(false, false);
    expect(report.reason).toBe("not_referral_discovery");
    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(prepareCreates).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("does not load the feed when another reconciliation holds the lock", async () => {
    const loadSnapshot = vi.fn();
    const prepareCreates = vi.fn();
    const runTransaction = vi.fn();
    const report = await reconcileMicro1ReferralEligibility({
      dryRun: false,
      referralDiscovery: true,
      loadSnapshot,
      listJobs: async () => [],
      prepareCreates,
      runTransaction,
      acquireLock: async () => false,
    });
    expect(report.reason).toBe("reconciliation_already_running");
    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(prepareCreates).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
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
