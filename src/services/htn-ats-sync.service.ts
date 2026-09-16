import { ApplicationSource, HtnAtsSyncStatus } from "@prisma/client";
import type { ApplicationWithRelations } from "../repositories/application.repository.js";
import { ApplicationRepository } from "../repositories/application.repository.js";
import type { CreateApplicationInput } from "./applications.service.js";
import {
  inputFromApplication,
  jobFromApplication,
  postHtnSubmissionToAts,
  type HtnAtsSubmissionJob,
  type RecruiterIdentity,
} from "./htn-ats-submission.service.js";
import {
  classifyAtsSyncFailure,
  hasReachedAtsSyncRetryCeiling,
  nextRetryAt,
  resolveAtsSyncMaxAttempts,
} from "./htn-ats-sync-policy.js";
import {
  createPrismaHtnAtsSyncStore,
  type HtnAtsSyncRecord,
  type HtnAtsSyncStore,
} from "./htn-ats-sync-store.js";

export type RecruiterSubmissionAtsResult = {
  status: HtnAtsSyncStatus;
  attemptCount: number;
  candidateId?: string | null;
  applicationId?: string | null;
  jobId?: string | null;
  candidate?: "created" | "updated";
  application?: "created" | "existing";
  lastError?: string | null;
  lastErrorCode?: string | null;
};

const repository = new ApplicationRepository();

export function recruiterSubmissionInput(
  body: Record<string, unknown>,
  jobId: string,
  recruiter?: RecruiterIdentity,
): Record<string, unknown> {
  return {
    ...body,
    jobId,
    source: ApplicationSource.RECRUITER,
    ...(recruiter?.id
      ? { recruiterId: recruiter.id, recruiterOrganizationId: recruiter.organizationId }
      : {}),
  };
}

export function toRecruiterAtsResponse(record: HtnAtsSyncRecord, ats?: {
  candidate?: "created" | "updated";
  application?: "created" | "existing";
}): RecruiterSubmissionAtsResult {
  return {
    status: record.status,
    attemptCount: record.attemptCount,
    candidateId: record.atsCandidateId,
    applicationId: record.atsApplicationId,
    jobId: record.atsJobId,
    candidate: ats?.candidate,
    application: ats?.application,
    lastError: record.lastError,
    lastErrorCode: record.lastErrorCode,
  };
}

function usableRecruiterId(id: string | null | undefined): id is string {
  const value = id?.trim();
  return Boolean(value) && value !== "unknown";
}

export function resolveRecruiterIdentity(
  claimed: Pick<HtnAtsSyncRecord, "recruiterId" | "recruiterOrganizationId">,
  job: HtnAtsSubmissionJob,
  override?: RecruiterIdentity,
): RecruiterIdentity | null {
  if (usableRecruiterId(override?.id)) {
    return {
      id: override.id.trim(),
      organizationId: override.organizationId || claimed.recruiterOrganizationId || job.organizationId,
    };
  }
  if (usableRecruiterId(claimed.recruiterId)) {
    return {
      id: claimed.recruiterId,
      organizationId: claimed.recruiterOrganizationId || job.organizationId,
    };
  }
  return null;
}

export async function processClaimedAtsSync(
  claimed: HtnAtsSyncRecord,
  options: {
    store?: HtnAtsSyncStore;
    loadApplication?: (id: string) => Promise<ApplicationWithRelations | null>;
    postToAts?: typeof postHtnSubmissionToAts;
    job?: HtnAtsSubmissionJob;
    input?: CreateApplicationInput;
    recruiter?: RecruiterIdentity;
    now?: Date;
    maxAttempts?: number;
  } = {},
): Promise<HtnAtsSyncRecord> {
  const store = options.store ?? createPrismaHtnAtsSyncStore();
  const loadApplication = options.loadApplication ?? ((id) => repository.findById(id));
  const postToAts = options.postToAts ?? postHtnSubmissionToAts;
  const now = options.now ?? new Date();
  const maxAttempts = options.maxAttempts ?? resolveAtsSyncMaxAttempts();

  try {
    const application = await loadApplication(claimed.applicationId);
    if (!application) {
      return store.markPermanentFailure(claimed.id, {
        attemptCount: claimed.attemptCount + 1,
        lastError: "HTN application no longer exists",
        lastErrorCode: "APPLICATION_NOT_FOUND",
      });
    }
    if (application.source !== ApplicationSource.RECRUITER) {
      return store.markPermanentFailure(claimed.id, {
        attemptCount: claimed.attemptCount + 1,
        lastError: "HTN ATS sync requires recruiter source",
        lastErrorCode: "VALIDATION_ERROR",
      });
    }

    const input = options.input ?? inputFromApplication(application);
    input.source = ApplicationSource.RECRUITER;
    const job = options.job ?? jobFromApplication(application);
    const attemptCount = claimed.attemptCount + 1;
    const atsJobId = typeof job.externalId === "string" ? job.externalId.trim() : "";
    if (!atsJobId) {
      return store.markPermanentFailure(claimed.id, {
        attemptCount,
        lastError: "HTN job has no ATS externalId; refusing to submit without a valid ATS job identity",
        lastErrorCode: "ATS_JOB_ID_MISSING",
      });
    }

    const recruiter = resolveRecruiterIdentity(claimed, job, options.recruiter);
    if (!recruiter) {
      return store.markPermanentFailure(claimed.id, {
        attemptCount,
        lastError: "Original recruiter identity is missing from durable HTN ATS sync data",
        lastErrorCode: "RECRUITER_IDENTITY_MISSING",
      });
    }

    const ats = await postToAts(application, input, job, recruiter);
    return store.markSynced(claimed.id, {
      atsCandidateId: ats.candidateId,
      atsApplicationId: ats.applicationId,
      atsJobId: ats.jobId,
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

export async function synchronizeHtnSubmission(options: {
  application: ApplicationWithRelations;
  input: CreateApplicationInput;
  job: HtnAtsSubmissionJob;
  recruiter: RecruiterIdentity;
  store?: HtnAtsSyncStore;
  postToAts?: typeof postHtnSubmissionToAts;
  now?: Date;
  maxAttempts?: number;
}): Promise<RecruiterSubmissionAtsResult> {
  const store = options.store ?? createPrismaHtnAtsSyncStore();
  const existing = await store.getByApplicationId(options.application.id);
  if (existing?.status === HtnAtsSyncStatus.SYNCED) {
    return toRecruiterAtsResponse(existing);
  }
  if (existing?.status === HtnAtsSyncStatus.FAILED) {
    return toRecruiterAtsResponse(existing);
  }

  const claimed = await store.claimDue({ applicationId: options.application.id, now: options.now });
  if (!claimed) {
    const current = await store.getByApplicationId(options.application.id);
    if (current) return toRecruiterAtsResponse(current);
    return {
      status: HtnAtsSyncStatus.PENDING,
      attemptCount: 0,
      lastError: "Durable ATS sync record was not found after persist",
      lastErrorCode: "SYNC_RECORD_MISSING",
    };
  }

  const record = await processClaimedAtsSync(claimed, {
    store,
    loadApplication: async () => options.application,
    postToAts: options.postToAts,
    job: options.job,
    input: options.input,
    recruiter: options.recruiter,
    now: options.now,
    maxAttempts: options.maxAttempts,
  });
  return toRecruiterAtsResponse(record);
}

export async function processDueAtsSyncs(options: {
  store?: HtnAtsSyncStore;
  limit?: number;
  now?: Date;
  postToAts?: typeof postHtnSubmissionToAts;
  loadApplication?: (id: string) => Promise<ApplicationWithRelations | null>;
  maxAttempts?: number;
} = {}): Promise<HtnAtsSyncRecord[]> {
  const store = options.store ?? createPrismaHtnAtsSyncStore();
  const limit = options.limit ?? 10;
  const processed: HtnAtsSyncRecord[] = [];
  for (let i = 0; i < limit; i += 1) {
    const claimed = await store.claimDue({ now: options.now });
    if (!claimed) break;
    processed.push(await processClaimedAtsSync(claimed, {
      store,
      now: options.now,
      postToAts: options.postToAts,
      loadApplication: options.loadApplication,
      maxAttempts: options.maxAttempts,
    }));
  }
  return processed;
}
