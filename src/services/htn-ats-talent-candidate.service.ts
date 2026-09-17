import { AppError } from "../errors/app-error.js";
import { ATS_SYNC_REQUEST_TIMEOUT_MS } from "./htn-ats-sync-policy.js";

export type HtnTalentCandidateForAts = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentTitle: string | null;
  yearsExperience: number | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
  githubUrl: string | null;
  metadata: unknown;
  currentOrganizationName: string | null;
  resume: {
    fileName: string | null;
    mimeType: string | null;
    size: number | null;
    storageKey: string | null;
  } | null;
};

export type AtsTalentCandidateResponse = {
  success: true;
  candidateId: string;
  candidate: "created" | "existing";
};

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

function metadataString(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  return clean((metadata as Record<string, unknown>)[key]);
}

export function buildHtnAtsTalentCandidatePayload(candidate: HtnTalentCandidateForAts) {
  if (!clean(candidate.email)) {
    throw new AppError("VALIDATION_ERROR", "Talent candidate email is required for ATS sync", 400);
  }
  const payload: Record<string, unknown> = {
    htnCandidateId: candidate.id,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    email: candidate.email,
  };
  const optionalFields: Array<[string, unknown]> = [
    ["phone", candidate.phone],
    ["location", candidate.location],
    ["currentCompany", candidate.currentOrganizationName],
    ["currentTitle", candidate.currentTitle],
    ["yearsExperience", candidate.yearsExperience],
    ["linkedinUrl", candidate.linkedinUrl],
    ["portfolioUrl", candidate.portfolioUrl],
    ["githubUrl", candidate.githubUrl],
    ["certifications", metadataString(candidate.metadata, "certifications")],
    ["additionalNotes", metadataString(candidate.metadata, "additionalNotes")],
  ];
  for (const [key, value] of optionalFields) {
    if (typeof value === "number" ? Number.isFinite(value) : clean(value)) {
      payload[key] = value;
    }
  }
  const resume = candidate.resume;
  const storageKey = clean(resume?.storageKey);
  if (storageKey) {
    payload.resume = {
      fileName: clean(resume?.fileName) || "resume.pdf",
      mimeType: clean(resume?.mimeType) || "application/pdf",
      size: resume?.size ?? 0,
      storageProvider: "CLOUDFLARE_R2",
      storageKey,
    };
  }
  return payload;
}

export async function postHtnTalentCandidateToAts(
  candidate: HtnTalentCandidateForAts,
  fetchImpl: typeof fetch = fetch,
): Promise<AtsTalentCandidateResponse> {
  const response = await fetchImpl(`${getAtsBaseUrl()}/api/integrations/htn/talent-candidates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getIntegrationKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(buildHtnAtsTalentCandidatePayload(candidate)),
    signal: AbortSignal.timeout(ATS_SYNC_REQUEST_TIMEOUT_MS),
  });
  const raw = await response.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    console.error("HTN to ATS talent candidate sync failed", {
      status: response.status,
      htnCandidateId: candidate.id,
    });
    throw new AppError(
      "ATS_SYNC_FAILED",
      `ATS talent candidate sync failed (${response.status})`,
      response.status,
    );
  }
  if (!body?.success || typeof body.candidateId !== "string" || !body.candidateId) {
    console.error("HTN to ATS talent candidate sync returned invalid response", {
      htnCandidateId: candidate.id,
    });
    throw new AppError("ATS_SYNC_INVALID_RESPONSE", "ATS returned an invalid talent candidate response", 502);
  }
  const candidateAction = body.candidate === "existing" ? "existing" : "created";
  return {
    success: true,
    candidateId: body.candidateId,
    candidate: candidateAction,
  };
}
