import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApplicationSource, HtnAtsSyncStatus } from "@prisma/client";
import { AppError } from "../src/errors/app-error.js";
import { recruiterSubmissionInput, processClaimedAtsSync, processDueAtsSyncs, synchronizeHtnSubmission } from "../src/services/htn-ats-sync.service.js";
import { createMemoryHtnAtsSyncStore, type HtnAtsSyncRecord } from "../src/services/htn-ats-sync-store.js";
import {
  classifyAtsSyncFailure,
  nextRetryAt,
  ATS_SYNC_RETRY_DELAYS_MS,
  ATS_SYNC_MAX_ATTEMPTS_DEFAULT,
  hasReachedAtsSyncRetryCeiling,
  resolveAtsSyncMaxAttempts,
} from "../src/services/htn-ats-sync-policy.js";
import type { ApplicationWithRelations } from "../src/repositories/application.repository.js";
import type { RecruiterIdentity } from "../src/services/htn-ats-submission.service.js";

const APPLICATION_ID = "94167e6e-ad9e-492a-bede-5c649d1920ff";
const CANDIDATE_ID = "b9de2eda-23a1-4345-a8e1-ae17b4a1beb0";
const JOB_ID = "cc9e2aef-a2ec-4713-8011-766b5953d362";
const ATS_JOB_ID = "cmtx2g8ue000rbkwok1e4ai44";

const application = {
  id: APPLICATION_ID,
  candidateId: CANDIDATE_ID,
  jobId: JOB_ID,
  source: ApplicationSource.RECRUITER,
  additionalNotes: "END-TO-END HTN ATS RECRUITER SUBMISSION TEST",
  salaryExpectation: null,
  candidate: {
    id: CANDIDATE_ID,
    firstName: "HTN",
    lastName: "Submission Test",
    email: "htn.submission.test@example.com",
    phone: "+1-555-0100",
    location: "Srinagar, Kashmir",
    currentTitle: "Test Candidate",
    yearsExperience: 3,
    linkedinUrl: null,
    documents: [],
  },
  job: {
    id: JOB_ID,
    externalId: ATS_JOB_ID,
    title: "test integration",
    status: "ACTIVE",
    location: null,
    organization: { id: "org-htn", externalId: "org-ats", name: "Headsbase" },
  },
} as unknown as ApplicationWithRelations;

const job = {
  id: JOB_ID,
  externalId: ATS_JOB_ID,
  organizationId: "org-htn",
  organizationExternalId: "org-ats",
};

const recruiter: RecruiterIdentity = { id: "recruiter-1", organizationId: "org-htn" };
const input = {
  jobId: JOB_ID,
  firstName: "HTN",
  lastName: "Submission Test",
  email: "htn.submission.test@example.com",
  source: ApplicationSource.RECRUITER,
};

function pendingRecord(overrides: Partial<HtnAtsSyncRecord> = {}): HtnAtsSyncRecord {
  return {
    id: "sync-1",
    applicationId: APPLICATION_ID,
    status: HtnAtsSyncStatus.PENDING,
    attemptCount: 0,
    lastAttemptAt: null,
    nextRetryAt: new Date(0),
    lastError: null,
    lastErrorCode: null,
    recruiterId: recruiter.id,
    recruiterOrganizationId: recruiter.organizationId,
    atsCandidateId: null,
    atsApplicationId: null,
    atsJobId: null,
    syncedAt: null,
    ...overrides,
  };
}

describe("recruiterSubmissionInput", () => {
  it("sets source = RECRUITER and the resolved HTN job id", () => {
    const payload = recruiterSubmissionInput({ jobId: "requested", firstName: "HTN" }, JOB_ID);
    expect(payload.source).toBe(ApplicationSource.RECRUITER);
    expect(payload.jobId).toBe(JOB_ID);
  });

  it("persists the submitting recruiter identity for durable retries", () => {
    const payload = recruiterSubmissionInput({ jobId: "requested" }, JOB_ID, recruiter);
    expect(payload.recruiterId).toBe(recruiter.id);
    expect(payload.recruiterOrganizationId).toBe(recruiter.organizationId);
  });
});

describe("classifyAtsSyncFailure", () => {
  it("treats 400/401/403/404 as permanent", () => {
    for (const status of [400, 401, 403, 404]) {
      const classified = classifyAtsSyncFailure(new AppError("ATS_SYNC_FAILED", `ATS submission sync failed (${status})`, status));
      expect(classified.retryable).toBe(false);
      expect(classified.code).toBe(`HTTP_${status}`);
    }
  });

  it("treats 5xx, timeouts, and network errors as retryable", () => {
    expect(classifyAtsSyncFailure(new AppError("ATS_SYNC_FAILED", "ATS submission sync failed (503)", 503)).retryable).toBe(true);
    expect(classifyAtsSyncFailure(new AppError("ATS_SYNC_FAILED", "ATS submission sync failed (500)", 500)).retryable).toBe(true);
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    expect(classifyAtsSyncFailure(timeout).retryable).toBe(true);
    expect(classifyAtsSyncFailure(new TypeError("fetch failed")).retryable).toBe(true);
  });

  it("treats missing integration config as retryable", () => {
    expect(classifyAtsSyncFailure(new AppError("INTEGRATION_NOT_CONFIGURED", "ATS integration is not configured", 503)).retryable).toBe(true);
  });
});

describe("nextRetryAt", () => {
  it("uses exponential delays capped at 30 minutes", () => {
    const now = new Date("2026-09-15T21:00:00.000Z");
    expect(nextRetryAt(1, now).getTime() - now.getTime()).toBe(ATS_SYNC_RETRY_DELAYS_MS[1]);
    expect(nextRetryAt(2, now).getTime() - now.getTime()).toBe(ATS_SYNC_RETRY_DELAYS_MS[2]);
    expect(nextRetryAt(4, now).getTime() - now.getTime()).toBe(ATS_SYNC_RETRY_DELAYS_MS[4]);
    expect(nextRetryAt(9, now).getTime() - now.getTime()).toBe(ATS_SYNC_RETRY_DELAYS_MS[4]);
  });
});

describe("synchronizeHtnSubmission", () => {
  it("marks SYNCED and records ATS IDs on success", async () => {
    const store = createMemoryHtnAtsSyncStore([pendingRecord()]);
    const result = await synchronizeHtnSubmission({
      application,
      input,
      job,
      recruiter,
      store,
      postToAts: async () => ({
        success: true,
        candidateId: "ats-cand-1",
        applicationId: "ats-app-1",
        jobId: "ats-job-1",
        candidate: "created",
        application: "created",
      }),
    });
    expect(result.status).toBe(HtnAtsSyncStatus.SYNCED);
    expect(result.candidateId).toBe("ats-cand-1");
    expect(result.applicationId).toBe("ats-app-1");
    expect(result.jobId).toBe("ats-job-1");
    const stored = await store.getByApplicationId(APPLICATION_ID);
    expect(stored?.status).toBe(HtnAtsSyncStatus.SYNCED);
    expect(stored?.lastError).toBeNull();
    expect(stored?.recruiterId).toBe(recruiter.id);
  });

  it("keeps the HTN submission retryable after an ATS 5xx", async () => {
    const store = createMemoryHtnAtsSyncStore([pendingRecord()]);
    const result = await synchronizeHtnSubmission({
      application,
      input,
      job,
      recruiter,
      store,
      postToAts: async () => {
        throw new AppError("ATS_SYNC_FAILED", "ATS submission sync failed (503)", 503);
      },
    });
    expect(result.status).toBe(HtnAtsSyncStatus.PENDING);
    expect(result.attemptCount).toBe(1);
    expect(result.lastErrorCode).toBe("HTTP_503");
    const stored = await store.getByApplicationId(APPLICATION_ID);
    expect(stored?.status).toBe(HtnAtsSyncStatus.PENDING);
    expect(stored?.nextRetryAt).toBeInstanceOf(Date);
  });

  it("keeps the HTN submission retryable after a network failure", async () => {
    const store = createMemoryHtnAtsSyncStore([pendingRecord()]);
    const result = await synchronizeHtnSubmission({
      application,
      input,
      job,
      recruiter,
      store,
      postToAts: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(result.status).toBe(HtnAtsSyncStatus.PENDING);
    expect(result.lastErrorCode).toBe("NETWORK");
  });

  it("marks permanent 400/401/403/404 as FAILED and does not schedule a retry", async () => {
    for (const status of [400, 401, 403, 404]) {
      const store = createMemoryHtnAtsSyncStore([pendingRecord({ id: `sync-${status}`, applicationId: APPLICATION_ID })]);
      const result = await synchronizeHtnSubmission({
        application,
        input,
        job,
        recruiter,
        store,
        postToAts: async () => {
          throw new AppError("ATS_SYNC_FAILED", `ATS submission sync failed (${status})`, status);
        },
      });
      expect(result.status).toBe(HtnAtsSyncStatus.FAILED);
      expect(result.lastErrorCode).toBe(`HTTP_${status}`);
      const stored = await store.getByApplicationId(APPLICATION_ID);
      expect(stored?.status).toBe(HtnAtsSyncStatus.FAILED);
      expect(stored?.nextRetryAt).toBeNull();
    }
  });

  it("does not call ATS again for an already SYNCED record", async () => {
    const store = createMemoryHtnAtsSyncStore([
      pendingRecord({
        status: HtnAtsSyncStatus.SYNCED,
        atsCandidateId: "ats-cand-1",
        atsApplicationId: "ats-app-1",
        atsJobId: "ats-job-1",
        nextRetryAt: null,
      }),
    ]);
    const postToAts = vi.fn();
    const result = await synchronizeHtnSubmission({
      application,
      input,
      job,
      recruiter,
      store,
      postToAts,
    });
    expect(postToAts).not.toHaveBeenCalled();
    expect(result.status).toBe(HtnAtsSyncStatus.SYNCED);
    expect(result.candidateId).toBe("ats-cand-1");
  });

  it("sends the original recruiter ID on the initial ATS submission", async () => {
    const store = createMemoryHtnAtsSyncStore([pendingRecord()]);
    const postToAts = vi.fn(async (_app, _input, _job, sentRecruiter: RecruiterIdentity) => {
      expect(sentRecruiter.id).toBe(recruiter.id);
      return {
        success: true as const,
        candidateId: "ats-cand-1",
        applicationId: "ats-app-1",
        jobId: ATS_JOB_ID,
        candidate: "created" as const,
        application: "created" as const,
      };
    });
    await synchronizeHtnSubmission({
      application,
      input,
      job,
      recruiter,
      store,
      postToAts,
    });
    expect(postToAts).toHaveBeenCalledOnce();
    expect(postToAts.mock.calls[0][3].id).toBe("recruiter-1");
    expect(postToAts.mock.calls[0][3].id).not.toBe("unknown");
  });
});

describe("retry worker", () => {
  it("increments attempt count and records ATS IDs on a successful retry", async () => {
    const store = createMemoryHtnAtsSyncStore([
      pendingRecord({ attemptCount: 1, nextRetryAt: new Date(0) }),
    ]);
    const processed = await processDueAtsSyncs({
      store,
      loadApplication: async () => application,
      postToAts: async () => ({
        success: true,
        candidateId: "ats-cand-retry",
        applicationId: "ats-app-retry",
        jobId: "ats-job-retry",
        candidate: "updated",
        application: "existing",
      }),
    });
    expect(processed).toHaveLength(1);
    expect(processed[0].status).toBe(HtnAtsSyncStatus.SYNCED);
    expect(processed[0].atsCandidateId).toBe("ats-cand-retry");
    expect(processed[0].atsApplicationId).toBe("ats-app-retry");
    expect(processed[0].attemptCount).toBe(2);
    expect(processed[0].recruiterId).toBe(recruiter.id);
  });

  it("does not endlessly retry a permanent FAILED record", async () => {
    const store = createMemoryHtnAtsSyncStore([
      pendingRecord({
        status: HtnAtsSyncStatus.FAILED,
        lastErrorCode: "HTTP_401",
        nextRetryAt: null,
      }),
    ]);
    const postToAts = vi.fn();
    const processed = await processDueAtsSyncs({
      store,
      loadApplication: async () => application,
      postToAts,
    });
    expect(processed).toHaveLength(0);
    expect(postToAts).not.toHaveBeenCalled();
  });

  it("sends the same HTN submission identity on every retry", async () => {
    const store = createMemoryHtnAtsSyncStore([pendingRecord({ attemptCount: 2 })]);
    const postToAts = vi.fn(async (app: ApplicationWithRelations, _input, _job, sentRecruiter: RecruiterIdentity) => {
      expect(app.id).toBe(APPLICATION_ID);
      expect(sentRecruiter.id).toBe(recruiter.id);
      throw new AppError("ATS_SYNC_FAILED", "ATS submission sync failed (503)", 503);
    });
    await processDueAtsSyncs({
      store,
      loadApplication: async () => application,
      postToAts,
    });
    expect(postToAts).toHaveBeenCalledOnce();
    expect(postToAts.mock.calls[0][0].id).toBe(APPLICATION_ID);
    expect(postToAts.mock.calls[0][3].id).toBe("recruiter-1");
    expect(postToAts.mock.calls[0][3].id).not.toBe("unknown");
  });

  it("loads the original recruiter from durable HTN data instead of unknown", async () => {
    const store = createMemoryHtnAtsSyncStore([
      pendingRecord({ attemptCount: 1, recruiterId: "recruiter-1", recruiterOrganizationId: "org-htn" }),
    ]);
    const postToAts = vi.fn(async (_app, _input, _job, sentRecruiter: RecruiterIdentity) => ({
      success: true as const,
      candidateId: "ats-cand-retry",
      applicationId: "ats-app-retry",
      jobId: ATS_JOB_ID,
      candidate: "updated" as const,
      application: "existing" as const,
    }));
    const processed = await processDueAtsSyncs({
      store,
      loadApplication: async () => application,
      postToAts,
    });
    expect(postToAts.mock.calls[0][3]).toEqual({ id: "recruiter-1", organizationId: "org-htn" });
    expect(processed[0].status).toBe(HtnAtsSyncStatus.SYNCED);
    expect(processed[0].recruiterId).toBe("recruiter-1");
  });

  it("ignores a fallback recruiter id of unknown and keeps the durable recruiter", async () => {
    const store = createMemoryHtnAtsSyncStore([pendingRecord({ attemptCount: 1 })]);
    const claimed = await store.claimDue();
    const postToAts = vi.fn(async (_app, _input, _job, sentRecruiter: RecruiterIdentity) => ({
      success: true as const,
      candidateId: "ats-cand-retry",
      applicationId: "ats-app-retry",
      jobId: ATS_JOB_ID,
      candidate: "updated" as const,
      application: "existing" as const,
    }));
    const updated = await processClaimedAtsSync(claimed!, {
      store,
      loadApplication: async () => application,
      recruiter: { id: "unknown", organizationId: job.organizationId },
      postToAts,
    });
    expect(postToAts.mock.calls[0][3].id).toBe("recruiter-1");
    expect(updated.status).toBe(HtnAtsSyncStatus.SYNCED);
    expect(updated.recruiterId).toBe("recruiter-1");
  });
});

describe("concurrency and idempotency", () => {
  it("lets only one claim succeed for the same pending record", async () => {
    const store = createMemoryHtnAtsSyncStore([pendingRecord()]);
    const [first, second] = await Promise.all([store.claimDue(), store.claimDue()]);
    const claimed = [first, second].filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.status).toBe(HtnAtsSyncStatus.SYNCING);
  });

  it("does not create duplicate ATS work when the same record is processed twice", async () => {
    const store = createMemoryHtnAtsSyncStore([pendingRecord()]);
    const postToAts = vi.fn(async () => ({
      success: true,
      candidateId: "ats-cand-1",
      applicationId: "ats-app-1",
      jobId: "ats-job-1",
      candidate: "created" as const,
      application: "created" as const,
    }));
    const [a, b] = await Promise.all([
      synchronizeHtnSubmission({ application, input, job, recruiter, store, postToAts }),
      synchronizeHtnSubmission({ application, input, job, recruiter, store, postToAts }),
    ]);
    expect(postToAts.mock.calls.length).toBe(1);
    expect([a.status, b.status]).toContain(HtnAtsSyncStatus.SYNCED);
    const stored = await store.getByApplicationId(APPLICATION_ID);
    expect(stored?.status).toBe(HtnAtsSyncStatus.SYNCED);
    expect(stored?.atsApplicationId).toBe("ats-app-1");
  });

  it("keeps a SYNCING claim from being processed a second time until it is stale", async () => {
    const store = createMemoryHtnAtsSyncStore([
      pendingRecord({
        status: HtnAtsSyncStatus.SYNCING,
        lastAttemptAt: new Date(),
      }),
    ]);
    const claimed = await store.claimDue();
    expect(claimed).toBeNull();
  });
});

describe("processClaimedAtsSync", () => {
  it("increments attempts on a retryable failure", async () => {
    const store = createMemoryHtnAtsSyncStore([pendingRecord()]);
    const claimed = await store.claimDue();
    const updated = await processClaimedAtsSync(claimed!, {
      store,
      loadApplication: async () => application,
      postToAts: async () => {
        throw new AppError("ATS_SYNC_FAILED", "ATS submission sync failed (502)", 502);
      },
    });
    expect(updated.attemptCount).toBe(1);
    expect(updated.status).toBe(HtnAtsSyncStatus.PENDING);
  });
});

describe("missing ATS job identity", () => {
  const jobWithoutAtsId = {
    ...application,
    job: { ...application.job, externalId: null, title: "HTN-only job" },
  } as unknown as ApplicationWithRelations;

  it("marks ATS_JOB_ID_MISSING as permanent FAILED with no ATS request", async () => {
    const store = createMemoryHtnAtsSyncStore([pendingRecord()]);
    const postToAts = vi.fn();
    const result = await synchronizeHtnSubmission({
      application: jobWithoutAtsId,
      input,
      job: { ...job, externalId: null },
      recruiter,
      store,
      postToAts,
    });
    expect(postToAts).not.toHaveBeenCalled();
    expect(result.status).toBe(HtnAtsSyncStatus.FAILED);
    expect(result.lastErrorCode).toBe("ATS_JOB_ID_MISSING");
    const stored = await store.getByApplicationId(APPLICATION_ID);
    expect(stored?.status).toBe(HtnAtsSyncStatus.FAILED);
    expect(stored?.nextRetryAt).toBeNull();
    expect(stored?.lastError).toMatch(/no ATS externalId/i);
  });

  it("still posts the normal ATS payload when the job has an ATS external ID", async () => {
    const store = createMemoryHtnAtsSyncStore([pendingRecord()]);
    const postToAts = vi.fn(async (_app, _input, sentJob) => {
      expect(sentJob.externalId).toBe(ATS_JOB_ID);
      return {
        success: true as const,
        candidateId: "ats-cand-1",
        applicationId: "ats-app-1",
        jobId: ATS_JOB_ID,
        candidate: "created" as const,
        application: "created" as const,
      };
    });
    const result = await synchronizeHtnSubmission({
      application,
      input,
      job,
      recruiter,
      store,
      postToAts,
    });
    expect(postToAts).toHaveBeenCalledOnce();
    expect(result.status).toBe(HtnAtsSyncStatus.SYNCED);
    expect(application.job.title).toBe("test integration");
    expect(application.job.externalId).toBe(ATS_JOB_ID);
  });
});

describe("retry ceiling", () => {
  it("defaults to 8 total attempts including the immediate first try", () => {
    expect(ATS_SYNC_MAX_ATTEMPTS_DEFAULT).toBe(8);
    expect(resolveAtsSyncMaxAttempts({})).toBe(8);
    expect(resolveAtsSyncMaxAttempts({ HTN_ATS_SYNC_MAX_ATTEMPTS: "12" })).toBe(12);
    expect(hasReachedAtsSyncRetryCeiling(7, 8)).toBe(false);
    expect(hasReachedAtsSyncRetryCeiling(8, 8)).toBe(true);
  });

  it("increments attempt count on each retryable failure", async () => {
    const store = createMemoryHtnAtsSyncStore([pendingRecord({ attemptCount: 2 })]);
    const claimed = await store.claimDue();
    const updated = await processClaimedAtsSync(claimed!, {
      store,
      loadApplication: async () => application,
      postToAts: async () => {
        throw new AppError("ATS_SYNC_FAILED", "ATS submission sync failed (502)", 502);
      },
    });
    expect(updated.attemptCount).toBe(3);
    expect(updated.status).toBe(HtnAtsSyncStatus.PENDING);
    expect(updated.nextRetryAt).toBeInstanceOf(Date);
  });

  it("transitions to FAILED after the maximum attempt count and stops retries", async () => {
    const store = createMemoryHtnAtsSyncStore([pendingRecord({ attemptCount: 7 })]);
    const claimed = await store.claimDue();
    const updated = await processClaimedAtsSync(claimed!, {
      store,
      maxAttempts: 8,
      loadApplication: async () => application,
      postToAts: async () => {
        throw new AppError("ATS_SYNC_FAILED", "ATS submission sync failed (503)", 503);
      },
    });
    expect(updated.attemptCount).toBe(8);
    expect(updated.status).toBe(HtnAtsSyncStatus.FAILED);
    expect(updated.nextRetryAt).toBeNull();
    expect(updated.lastErrorCode).toBe("HTTP_503");
    expect(updated.lastError).toContain("503");

    const postToAts = vi.fn();
    const processed = await processDueAtsSyncs({
      store,
      loadApplication: async () => application,
      postToAts,
    });
    expect(processed).toHaveLength(0);
    expect(postToAts).not.toHaveBeenCalled();
  });
});

describe("production migration deployment", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");

  it("uses prisma migrate deploy via Railway pre-deploy, not migrate dev or db push", () => {
    const railway = readFileSync(join(root, "railway.toml"), "utf8");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const migration = readFileSync(
      join(root, "prisma/migrations/20260915233000_add_htn_ats_submission_sync/migration.sql"),
      "utf8",
    );

    expect(pkg.scripts["db:migrate:deploy"]).toBe("prisma migrate deploy");
    expect(pkg.scripts.start).toBe("node dist/src/server.js");
    expect(pkg.scripts.start).not.toMatch(/migrate dev|db push|migrate reset|db seed/);
    expect(railway).toContain("preDeployCommand");
    expect(railway).toContain("npm run db:migrate:deploy");
    const preDeployLine = railway.split(/\r?\n/).find((line) => line.includes("preDeployCommand")) ?? "";
    expect(preDeployLine).toMatch(/npm run db:migrate:deploy/);
    expect(preDeployLine).not.toMatch(/migrate dev|db push|migrate reset/);
    expect(migration).toContain('CREATE TABLE "HtnAtsSubmissionSync"');
    expect(migration).toContain('"recruiterId" TEXT');
    expect(migration).toContain('"recruiterOrganizationId" TEXT');
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});
