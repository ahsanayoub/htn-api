import { DocumentType, HtnAtsSyncStatus } from "@prisma/client";
import prisma from "../prisma/client.js";
import {
  classifyAtsSyncFailure,
  hasReachedAtsSyncRetryCeiling,
  nextRetryAt,
  resolveAtsSyncMaxAttempts,
} from "./htn-ats-sync-policy.js";
import {
  createPrismaHtnAtsCandidateSyncStore,
  type HtnAtsCandidateSyncRecord,
  type HtnAtsCandidateSyncStore,
} from "./htn-ats-candidate-sync-store.js";
import {
  postHtnTalentCandidateToAts,
  type HtnTalentCandidateForAts,
} from "./htn-ats-talent-candidate.service.js";

export type TalentCandidateAtsResult = {
  status: HtnAtsSyncStatus;
  attemptCount: number;
  candidateId?: string | null;
  candidate?: "created" | "existing";
  lastError?: string | null;
  lastErrorCode?: string | null;
};

export function toTalentCandidateAtsResponse(
  record: HtnAtsCandidateSyncRecord,
  ats?: { candidate?: "created" | "existing" },
): TalentCandidateAtsResult {
  return {
    status: record.status,
    attemptCount: record.attemptCount,
    candidateId: record.atsCandidateId,
    candidate: ats?.candidate,
    lastError: record.lastError,
    lastErrorCode: record.lastErrorCode,
  };
}

export async function loadTalentCandidateForAts(
  htnCandidateId: string,
): Promise<HtnTalentCandidateForAts | null> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: htnCandidateId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      location: true,
      currentTitle: true,
      yearsExperience: true,
      linkedinUrl: true,
      portfolioUrl: true,
      githubUrl: true,
      metadata: true,
      currentOrganization: { select: { name: true } },
      documents: {
        where: { type: DocumentType.RESUME, isLatest: true },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          fileName: true,
          mimeType: true,
          size: true,
          storageKey: true,
        },
      },
    },
  });
  if (!candidate) return null;
  return {
    id: candidate.id,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    email: candidate.email,
    phone: candidate.phone,
    location: candidate.location,
    currentTitle: candidate.currentTitle,
    yearsExperience: candidate.yearsExperience,
    linkedinUrl: candidate.linkedinUrl,
    portfolioUrl: candidate.portfolioUrl,
    githubUrl: candidate.githubUrl,
    metadata: candidate.metadata,
    currentOrganizationName: candidate.currentOrganization?.name ?? null,
    resume: candidate.documents[0]
      ? {
          fileName: candidate.documents[0].fileName,
          mimeType: candidate.documents[0].mimeType,
          size: candidate.documents[0].size,
          storageKey: candidate.documents[0].storageKey,
        }
      : null,
  };
}

export async function processClaimedTalentCandidateAtsSync(
  claimed: HtnAtsCandidateSyncRecord,
  options: {
    store?: HtnAtsCandidateSyncStore;
    loadCandidate?: (id: string) => Promise<HtnTalentCandidateForAts | null>;
    postToAts?: typeof postHtnTalentCandidateToAts;
    now?: Date;
    maxAttempts?: number;
  } = {},
): Promise<HtnAtsCandidateSyncRecord> {
  const store = options.store ?? createPrismaHtnAtsCandidateSyncStore();
  const loadCandidate = options.loadCandidate ?? loadTalentCandidateForAts;
  const postToAts = options.postToAts ?? postHtnTalentCandidateToAts;
  const now = options.now ?? new Date();
  const maxAttempts = options.maxAttempts ?? resolveAtsSyncMaxAttempts();

  try {
    const candidate = await loadCandidate(claimed.htnCandidateId);
    if (!candidate) {
      return store.markPermanentFailure(claimed.id, {
        attemptCount: claimed.attemptCount + 1,
        lastError: "HTN talent candidate no longer exists",
        lastErrorCode: "CANDIDATE_NOT_FOUND",
      });
    }

    const attemptCount = claimed.attemptCount + 1;
    const ats = await postToAts(candidate);
    return store.markSynced(claimed.id, {
      atsCandidateId: ats.candidateId,
      attemptCount,
    });
  } catch (error) {
    const classified = classifyAtsSyncFailure(error);
    const attemptCount = claimed.attemptCount + 1;
    if (classified.retryable && !hasReachedAtsSyncRetryCeiling(attemptCount, maxAttempts)) {
      return store.markRetryable(claimed.id, {
        attemptCount,
        lastError: classified.message,
        lastErrorCode: classified.code,
        nextRetryAt: nextRetryAt(attemptCount, now),
      });
    }
    return store.markPermanentFailure(claimed.id, {
      attemptCount,
      lastError: classified.message,
      lastErrorCode: classified.code,
    });
  }
}

/**
 * Ensure a durable sync row exists and attempt an immediate ATS POST.
 * Failures leave the row PENDING/FAILED for the worker — never throws to the caller path
 * when used with try/catch from joinTalentNetwork.
 */
export async function synchronizeHtnTalentCandidate(options: {
  htnCandidateId: string;
  store?: HtnAtsCandidateSyncStore;
  loadCandidate?: (id: string) => Promise<HtnTalentCandidateForAts | null>;
  postToAts?: typeof postHtnTalentCandidateToAts;
  now?: Date;
  maxAttempts?: number;
}): Promise<TalentCandidateAtsResult> {
  const store = options.store ?? createPrismaHtnAtsCandidateSyncStore();
  await store.ensurePending(options.htnCandidateId, options.now);

  const existing = await store.getByHtnCandidateId(options.htnCandidateId);
  if (existing?.status === HtnAtsSyncStatus.SYNCED) {
    return toTalentCandidateAtsResponse(existing);
  }
  if (existing?.status === HtnAtsSyncStatus.FAILED) {
    return toTalentCandidateAtsResponse(existing);
  }

  const claimed = await store.claimDue({
    htnCandidateId: options.htnCandidateId,
    now: options.now,
  });
  if (!claimed) {
    const current = await store.getByHtnCandidateId(options.htnCandidateId);
    if (current) return toTalentCandidateAtsResponse(current);
    return {
      status: HtnAtsSyncStatus.PENDING,
      attemptCount: 0,
      lastError: "Durable ATS candidate sync record was not found after persist",
      lastErrorCode: "SYNC_RECORD_MISSING",
    };
  }

  const record = await processClaimedTalentCandidateAtsSync(claimed, {
    store,
    loadCandidate: options.loadCandidate,
    postToAts: options.postToAts,
    now: options.now,
    maxAttempts: options.maxAttempts,
  });

  // Re-read for candidate action is not stored on the sync row; infer from attempt.
  return toTalentCandidateAtsResponse(record);
}

export async function processDueTalentCandidateAtsSyncs(options: {
  store?: HtnAtsCandidateSyncStore;
  limit?: number;
  now?: Date;
  postToAts?: typeof postHtnTalentCandidateToAts;
  loadCandidate?: (id: string) => Promise<HtnTalentCandidateForAts | null>;
  maxAttempts?: number;
} = {}): Promise<HtnAtsCandidateSyncRecord[]> {
  const store = options.store ?? createPrismaHtnAtsCandidateSyncStore();
  const limit = options.limit ?? 10;
  const processed: HtnAtsCandidateSyncRecord[] = [];
  for (let i = 0; i < limit; i += 1) {
    const claimed = await store.claimDue({ now: options.now });
    if (!claimed) break;
    processed.push(
      await processClaimedTalentCandidateAtsSync(claimed, {
        store,
        now: options.now,
        postToAts: options.postToAts,
        loadCandidate: options.loadCandidate,
        maxAttempts: options.maxAttempts,
      }),
    );
  }
  return processed;
}
