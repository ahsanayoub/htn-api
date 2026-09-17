import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HtnAtsSyncStatus } from "@prisma/client";
import { AppError } from "../src/errors/app-error.js";
import {
  processClaimedTalentCandidateAtsSync,
  processDueTalentCandidateAtsSyncs,
  synchronizeHtnTalentCandidate,
} from "../src/services/htn-ats-candidate-sync.service.js";
import {
  createMemoryHtnAtsCandidateSyncStore,
  type HtnAtsCandidateSyncRecord,
} from "../src/services/htn-ats-candidate-sync-store.js";
import {
  buildHtnAtsTalentCandidatePayload,
  type HtnTalentCandidateForAts,
} from "../src/services/htn-ats-talent-candidate.service.js";
import { CandidateService } from "../src/services/candidate.service.js";
import { classifyAtsSyncFailure } from "../src/services/htn-ats-sync-policy.js";

const HTN_CANDIDATE_ID = "b9de2eda-23a1-4345-a8e1-ae17b4a1beb0";

const VALID_RESUME = {
  uploadId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  storageKey: "htn/resumes/ada-talent.pdf",
  fileName: "ada.pdf",
  mimeType: "application/pdf",
  size: 2048,
};

const { mockTx, mockTransaction, mockVerifyResume } = vi.hoisted(() => {
  const mockVerifyResume = vi.fn().mockResolvedValue({
    size: 2048,
    mimeType: "application/pdf",
    etag: "etag-1",
  });
  const mockTx = {
    candidate: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    document: { create: vi.fn() },
    organization: { findFirst: vi.fn(), create: vi.fn() },
  };
  const mockTransaction = vi.fn(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx));
  return { mockTx, mockTransaction, mockVerifyResume };
});

vi.mock("../src/prisma/client.js", () => ({
  default: { $transaction: mockTransaction },
}));

vi.mock("../src/services/r2-storage.service.js", () => ({
  R2StorageService: class {
    verifyUploadedResume = mockVerifyResume;
  },
}));

const talentCandidate: HtnTalentCandidateForAts = {
  id: HTN_CANDIDATE_ID,
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada.talent@example.com",
  phone: "+1-202-555-0199",
  location: "London",
  currentTitle: "Mathematician",
  yearsExperience: 8,
  linkedinUrl: "https://www.linkedin.com/in/ada-talent",
  portfolioUrl: "https://example.com/ada",
  githubUrl: "https://github.com/ada",
  metadata: { certifications: "AWS", additionalNotes: "Talent pool" },
  currentOrganizationName: "Analytical Engines",
  resume: {
    fileName: "ada.pdf",
    mimeType: "application/pdf",
    size: 2048,
    storageKey: "htn/resumes/ada-talent.pdf",
  },
};

function pendingRecord(overrides: Partial<HtnAtsCandidateSyncRecord> = {}): HtnAtsCandidateSyncRecord {
  return {
    id: "cand-sync-1",
    htnCandidateId: HTN_CANDIDATE_ID,
    status: HtnAtsSyncStatus.PENDING,
    attemptCount: 0,
    lastAttemptAt: null,
    nextRetryAt: new Date(0),
    lastError: null,
    lastErrorCode: null,
    atsCandidateId: null,
    syncedAt: null,
    ...overrides,
  };
}

describe("buildHtnAtsTalentCandidatePayload", () => {
  it("builds talent payload without atsJobId or application fields", () => {
    const payload = buildHtnAtsTalentCandidatePayload(talentCandidate);
    expect(payload.htnCandidateId).toBe(HTN_CANDIDATE_ID);
    expect(payload.email).toBe("ada.talent@example.com");
    expect(payload.resume).toEqual({
      fileName: "ada.pdf",
      mimeType: "application/pdf",
      size: 2048,
      storageProvider: "CLOUDFLARE_R2",
      storageKey: "htn/resumes/ada-talent.pdf",
    });
    expect(payload).not.toHaveProperty("atsJobId");
    expect(payload).not.toHaveProperty("htnSubmissionId");
  });
});

describe("synchronizeHtnTalentCandidate", () => {
  it("marks SYNCED and records atsCandidateId on success", async () => {
    const store = createMemoryHtnAtsCandidateSyncStore([pendingRecord()]);
    const result = await synchronizeHtnTalentCandidate({
      htnCandidateId: HTN_CANDIDATE_ID,
      store,
      loadCandidate: async () => talentCandidate,
      postToAts: async () => ({
        success: true,
        candidateId: "ats-cand-1",
        candidate: "created",
      }),
    });
    expect(result.status).toBe(HtnAtsSyncStatus.SYNCED);
    expect(result.candidateId).toBe("ats-cand-1");
    const stored = await store.getByHtnCandidateId(HTN_CANDIDATE_ID);
    expect(stored?.atsCandidateId).toBe("ats-cand-1");
    expect(stored?.status).toBe(HtnAtsSyncStatus.SYNCED);
  });

  it("leaves sync retryable on ATS 5xx / network failure", async () => {
    const store = createMemoryHtnAtsCandidateSyncStore([pendingRecord()]);
    const result = await synchronizeHtnTalentCandidate({
      htnCandidateId: HTN_CANDIDATE_ID,
      store,
      loadCandidate: async () => talentCandidate,
      postToAts: async () => {
        throw new AppError("ATS_SYNC_FAILED", "ATS talent candidate sync failed (503)", 503);
      },
    });
    expect(result.status).toBe(HtnAtsSyncStatus.PENDING);
    expect(result.lastErrorCode).toBe("HTTP_503");
    const stored = await store.getByHtnCandidateId(HTN_CANDIDATE_ID);
    expect(stored?.status).toBe(HtnAtsSyncStatus.PENDING);
    expect(stored?.atsCandidateId).toBeNull();
    expect(stored?.nextRetryAt).toBeTruthy();
  });

  it("marks FAILED on permanent ATS 4xx and does not schedule another retry", async () => {
    const store = createMemoryHtnAtsCandidateSyncStore([pendingRecord()]);
    const result = await synchronizeHtnTalentCandidate({
      htnCandidateId: HTN_CANDIDATE_ID,
      store,
      loadCandidate: async () => talentCandidate,
      postToAts: async () => {
        throw new AppError("ATS_SYNC_FAILED", "ATS talent candidate sync failed (400)", 400);
      },
    });
    expect(result.status).toBe(HtnAtsSyncStatus.FAILED);
    expect(result.lastErrorCode).toBe("HTTP_400");
    const stored = await store.getByHtnCandidateId(HTN_CANDIDATE_ID);
    expect(stored?.status).toBe(HtnAtsSyncStatus.FAILED);
    expect(stored?.atsCandidateId).toBeNull();
    expect(stored?.nextRetryAt).toBeNull();
  });

  it("is idempotent for the same HTN candidate ID", async () => {
    const store = createMemoryHtnAtsCandidateSyncStore([pendingRecord()]);
    const postToAts = vi.fn(async () => ({
      success: true as const,
      candidateId: "ats-cand-1",
      candidate: "created" as const,
    }));
    const first = await synchronizeHtnTalentCandidate({
      htnCandidateId: HTN_CANDIDATE_ID,
      store,
      loadCandidate: async () => talentCandidate,
      postToAts,
    });
    const second = await synchronizeHtnTalentCandidate({
      htnCandidateId: HTN_CANDIDATE_ID,
      store,
      loadCandidate: async () => talentCandidate,
      postToAts,
    });
    expect(first.candidateId).toBe(second.candidateId);
    expect(second.status).toBe(HtnAtsSyncStatus.SYNCED);
    expect(postToAts).toHaveBeenCalledTimes(1);
  });

  it("ensurePending reuses the same sync record", async () => {
    const store = createMemoryHtnAtsCandidateSyncStore();
    const a = await store.ensurePending(HTN_CANDIDATE_ID);
    const b = await store.ensurePending(HTN_CANDIDATE_ID);
    expect(a.id).toBe(b.id);
  });
});

describe("processDueTalentCandidateAtsSyncs", () => {
  it("retries a pending failure and records atsCandidateId", async () => {
    const store = createMemoryHtnAtsCandidateSyncStore([
      pendingRecord({
        attemptCount: 1,
        lastError: "ATS talent candidate sync failed (503)",
        lastErrorCode: "HTTP_503",
      }),
    ]);
    const processed = await processDueTalentCandidateAtsSyncs({
      store,
      loadCandidate: async () => talentCandidate,
      postToAts: async () => ({
        success: true,
        candidateId: "ats-cand-retry",
        candidate: "existing",
      }),
    });
    expect(processed).toHaveLength(1);
    expect(processed[0].status).toBe(HtnAtsSyncStatus.SYNCED);
    expect(processed[0].atsCandidateId).toBe("ats-cand-retry");
  });
});

describe("processClaimedTalentCandidateAtsSync concurrency", () => {
  it("serializes claimDue so two workers do not double-post casually", async () => {
    const store = createMemoryHtnAtsCandidateSyncStore([pendingRecord()]);
    const postToAts = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return {
        success: true as const,
        candidateId: "ats-cand-1",
        candidate: "created" as const,
      };
    });
    const [a, b] = await Promise.all([
      store.claimDue({ htnCandidateId: HTN_CANDIDATE_ID }).then(async (claimed) => {
        if (!claimed) return null;
        return processClaimedTalentCandidateAtsSync(claimed, {
          store,
          loadCandidate: async () => talentCandidate,
          postToAts,
        });
      }),
      store.claimDue({ htnCandidateId: HTN_CANDIDATE_ID }).then(async (claimed) => {
        if (!claimed) return null;
        return processClaimedTalentCandidateAtsSync(claimed, {
          store,
          loadCandidate: async () => talentCandidate,
          postToAts,
        });
      }),
    ]);
    const outcomes = [a, b].filter(Boolean);
    expect(outcomes).toHaveLength(1);
    expect(postToAts).toHaveBeenCalledTimes(1);
  });
});

describe("classifyAtsSyncFailure for talent candidate path", () => {
  it("treats network failures as retryable", () => {
    expect(classifyAtsSyncFailure(new TypeError("fetch failed")).retryable).toBe(true);
  });
});

describe("CandidateService.joinTalentNetwork ATS sync wiring", () => {
  beforeEach(() => {
    mockTransaction.mockClear();
    mockVerifyResume.mockReset();
    mockVerifyResume.mockResolvedValue({
      size: 2048,
      mimeType: "application/pdf",
      etag: "etag-1",
    });
    mockTx.candidate.findFirst.mockReset();
    mockTx.candidate.create.mockReset();
    mockTx.candidate.update.mockReset();
    mockTx.document.create.mockReset();
    mockTx.organization.findFirst.mockReset();
    mockTx.organization.create.mockReset();
  });

  it("persists HTN candidate and still succeeds when ATS sync throws", async () => {
    const callOrder: string[] = [];
    mockTransaction.mockImplementation(async (fn: (tx: typeof mockTx) => unknown) => {
      callOrder.push("htn-persist");
      return fn(mockTx);
    });

    const syncTalentCandidateToAts = vi.fn().mockImplementation(async () => {
      callOrder.push("ats-sync");
      throw new AppError("ATS_SYNC_FAILED", "ATS talent candidate sync failed (503)", 503);
    });

    mockTx.candidate.findFirst.mockResolvedValue(null);
    mockTx.organization.findFirst.mockResolvedValue(null);
    mockTx.organization.create.mockResolvedValue({ id: "org-1" });
    mockTx.candidate.create.mockResolvedValue({
      id: HTN_CANDIDATE_ID,
      email: "ada.talent@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      metadata: null,
    });
    mockTx.candidate.update.mockResolvedValue({
      id: HTN_CANDIDATE_ID,
      email: "ada.talent@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      metadata: null,
      inTalentPool: true,
      contactConsent: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockTx.document.create.mockResolvedValue({ id: "doc-1" });

    const service = new CandidateService({ syncTalentCandidateToAts });
    const result = await service.joinTalentNetwork({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada.talent@example.com",
      resume: VALID_RESUME,
      contactConsent: true,
    });

    expect(result.id).toBe(HTN_CANDIDATE_ID);
    expect(result.inTalentPool).toBe(true);
    expect(result.contactConsent).toBe(true);
    expect(mockTx.candidate.create).toHaveBeenCalledOnce();
    expect(mockTx.candidate.update).toHaveBeenCalledOnce();
    expect(mockTx.document.create).toHaveBeenCalledOnce();
    expect(syncTalentCandidateToAts).toHaveBeenCalledWith(HTN_CANDIDATE_ID);
    expect(callOrder).toEqual(["htn-persist", "ats-sync"]);
  });
});

describe("migration", () => {
  it("creates HtnAtsCandidateSync table migration", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const migration = readFileSync(
      join(dir, "../prisma/migrations/20260917_htn_ats_candidate_sync/migration.sql"),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "HtnAtsCandidateSync"');
    expect(migration).toContain('"htnCandidateId"');
    expect(migration).toContain('CREATE UNIQUE INDEX "HtnAtsCandidateSync_htnCandidateId_key"');
  });
});
