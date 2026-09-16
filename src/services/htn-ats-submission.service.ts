import { ApplicationSource, Prisma } from "@prisma/client";
import { AppError } from "../errors/app-error.js";
import type { ApplicationWithRelations } from "../repositories/application.repository.js";
import type { CreateApplicationInput } from "./applications.service.js";
import { ATS_SYNC_REQUEST_TIMEOUT_MS } from "./htn-ats-sync-policy.js";

export interface HtnAtsSubmissionJob {
  id: string;
  externalId: string | null;
  organizationId: string;
  organizationExternalId: string | null;
}

export interface RecruiterIdentity {
  id: string;
  organizationId: string;
}

function getAtsBaseUrl(): string {
  const value = process.env.HTN_ATS_API_URL?.trim();
  if (!value) throw new AppError("INTEGRATION_NOT_CONFIGURED", "HTN ATS API URL is not configured", 503);
  return value.replace(/\/$/, "");
}

function getIntegrationKey(): string {
  const value = process.env.HTN_ATS_INTEGRATION_KEY?.trim();
  if (!value) throw new AppError("INTEGRATION_NOT_CONFIGURED", "ATS integration is not configured", 503);
  return value;
}

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** @deprecated Durable HtnAtsSubmissionSync rows are the authoritative sync state. */
export type HtnAtsSyncMetadata = {
  status: "SYNCED" | "FAILED";
  candidateId?: string;
  applicationId?: string;
  jobId?: string;
  syncedAt?: string;
  lastAttemptAt?: string;
  error?: string;
};

/** @deprecated Durable HtnAtsSubmissionSync rows are the authoritative sync state. */
export function getHtnAtsSyncMetadata(metadata: unknown): HtnAtsSyncMetadata | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>).htnAtsSync;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const sync = value as Record<string, unknown>;
  if (sync.status !== "SYNCED" && sync.status !== "FAILED") return undefined;
  return sync as HtnAtsSyncMetadata;
}

/** @deprecated Durable HtnAtsSubmissionSync rows are the authoritative sync state. */
export function mergeHtnAtsSyncMetadata(metadata: unknown, sync: HtnAtsSyncMetadata): Prisma.InputJsonValue {
  const base = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
  return { ...base, htnAtsSync: sync } as Prisma.InputJsonValue;
}

export type AtsSubmissionResponse = {
  success: true;
  candidateId: string;
  applicationId: string;
  jobId: string;
  candidate: "created" | "updated";
  application: "created" | "existing";
};

export function buildHtnAtsSubmissionPayload(
  application: ApplicationWithRelations,
  input: CreateApplicationInput,
  job: HtnAtsSubmissionJob,
  recruiter: RecruiterIdentity,
) {
  const resume = application.candidate.documents[0];
  const candidate = application.candidate;
  const payload: Record<string, unknown> = {
    htnCandidateId: candidate.id,
    htnSubmissionId: application.id,
    htnJobId: job.id,
    organization: {
      ...(job.organizationExternalId ? { id: job.organizationExternalId } : {}),
      htnId: job.organizationId,
    },
    recruiter: { id: recruiter.id },
    candidate: { firstName: candidate.firstName, lastName: candidate.lastName, email: candidate.email },
  };
  if (job.externalId) payload.atsJobId = job.externalId;
  const candidatePayload = payload.candidate as Record<string, unknown>;
  const optionalCandidateFields: Array<[string, unknown]> = [
    ["phone", candidate.phone],
    ["location", candidate.location],
    ["currentCompany", input.currentCompany],
    ["currentTitle", candidate.currentTitle],
    ["yearsExperience", candidate.yearsExperience],
    ["linkedInUrl", candidate.linkedinUrl],
    ["desiredSalary", application.salaryExpectation],
    ["additionalNotes", application.additionalNotes],
  ];
  for (const [key, value] of optionalCandidateFields) {
    if (typeof value === "number" ? Number.isFinite(value) : clean(value)) candidatePayload[key] = value;
  }
  if (resume) {
    payload.resume = {
      fileName: resume.fileName,
      mimeType: resume.mimeType,
      sizeBytes: resume.size,
      storageProvider: "CLOUDFLARE_R2",
      storageKey: resume.storageKey,
    };
  }
  return payload;
}

export function jobFromApplication(application: ApplicationWithRelations): HtnAtsSubmissionJob {
  return {
    id: application.job.id,
    externalId: application.job.externalId ?? null,
    organizationId: application.job.organization.id,
    organizationExternalId: application.job.organization.externalId ?? null,
  };
}

export function inputFromApplication(application: ApplicationWithRelations): CreateApplicationInput {
  return {
    jobId: application.job.id,
    firstName: application.candidate.firstName,
    lastName: application.candidate.lastName,
    email: application.candidate.email ?? "",
    phone: application.candidate.phone ?? undefined,
    currentTitle: application.candidate.currentTitle ?? undefined,
    yearsExperience: application.candidate.yearsExperience ?? undefined,
    linkedinUrl: application.candidate.linkedinUrl ?? undefined,
    location: application.candidate.location ?? undefined,
    additionalNotes: application.additionalNotes ?? undefined,
    source: ApplicationSource.RECRUITER,
  };
}

export async function postHtnSubmissionToAts(
  application: ApplicationWithRelations,
  input: CreateApplicationInput,
  job: HtnAtsSubmissionJob,
  recruiter: RecruiterIdentity,
  fetchImpl: typeof fetch = fetch,
): Promise<AtsSubmissionResponse> {
  if (input.source !== ApplicationSource.RECRUITER) {
    throw new AppError("VALIDATION_ERROR", "HTN ATS sync requires recruiter source", 400);
  }
  const response = await fetchImpl(`${getAtsBaseUrl()}/api/integrations/htn/submissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getIntegrationKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(buildHtnAtsSubmissionPayload(application, input, job, recruiter)),
    signal: AbortSignal.timeout(ATS_SYNC_REQUEST_TIMEOUT_MS),
  });
  const raw = await response.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = raw ? JSON.parse(raw) as Record<string, unknown> : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    console.error("HTN to ATS submission sync failed", {
      status: response.status,
      candidateId: application.candidate.id,
      applicationId: application.id,
      jobId: job.id,
    });
    throw new AppError("ATS_SYNC_FAILED", `ATS submission sync failed (${response.status})`, response.status);
  }
  if (!body?.success || !body?.candidateId || !body?.applicationId || !body?.jobId) {
    console.error("HTN to ATS submission sync returned invalid response", {
      candidateId: application.candidate.id,
      applicationId: application.id,
      jobId: job.id,
    });
    throw new AppError("ATS_SYNC_INVALID_RESPONSE", "ATS returned an invalid submission response", 502);
  }
  return body as AtsSubmissionResponse;
}

/** Immediate ATS POST used by tests that mock fetch; durable orchestration lives in htn-ats-sync.service.ts. */
export async function syncHtnSubmissionToAts(
  application: ApplicationWithRelations,
  input: CreateApplicationInput,
  job: HtnAtsSubmissionJob,
  recruiter: RecruiterIdentity,
) {
  return postHtnSubmissionToAts(application, input, job, recruiter);
}
