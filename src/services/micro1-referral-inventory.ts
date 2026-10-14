import { MICRO1_ELIGIBLE_JOBS_PAGE_LIMIT } from "../config/micro1.config.js";

export const REFERRAL_INVENTORY_PAGE_LIMIT = MICRO1_ELIGIBLE_JOBS_PAGE_LIMIT;
export const REFERRAL_INVENTORY_MAX_PAGES = 500;
export const REFERRAL_INVENTORY_PATH = "/referral/portal/eligible-jobs";

export type ReferralInventoryFetcher = (
  page: number,
  limit: number,
) => Promise<unknown>;

export type ReferralUrlAssessment = {
  hostIsJobsMicro1: boolean;
  pathContainsJobId: boolean;
  hasReferralCodeParam: boolean;
  structurallyValid: boolean;
  /** Scheme, host, path, and query keys only. Query values are omitted. */
  redactedShape: string;
};

export type ReferralInventoryJob = {
  jobId: string;
  referralUrl: ReferralUrlAssessment;
  referralShapeConflict: boolean;
};

export type ReferralInventoryInvalidRow = {
  page: number;
  index: number;
  reason: "missing job_id" | "empty job_id" | "non-string job_id";
};

export type ReferralInventoryFailure = {
  page: number;
  message: string;
};

export type ReferralInventoryPage = {
  page: number;
  rowCount: number;
  reportedTotal: number | null;
};

export type ReferralInventoryCapture = {
  capturedAt: string;
  request: {
    method: "GET";
    path: typeof REFERRAL_INVENTORY_PATH;
    pageLimit: number;
  };
  reportedTotal: number | null;
  pages: ReferralInventoryPage[];
  pagesFetched: number;
  rawCount: number;
  uniqueCount: number;
  duplicateIds: string[];
  invalidRows: ReferralInventoryInvalidRow[];
  failures: ReferralInventoryFailure[];
  inventoryComplete: boolean;
  completionNotes: string[];
  jobs: ReferralInventoryJob[];
};

type ParsedRow = {
  jobId: string | null;
  invalidReason: ReferralInventoryInvalidRow["reason"] | null;
  applyUrl: string | null;
};

type SeenJob = {
  job: ReferralInventoryJob;
  count: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function sanitizeDiagnosticText(text: string, secrets: readonly string[] = []): string {
  let out = text;
  const uniqueSecrets = [...secrets].filter((secret) => secret.trim().length > 0).sort((a, b) => b.length - a.length);
  for (const secret of uniqueSecrets) {
    out = out.split(secret).join("[redacted]");
  }
  out = out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  out = out.replace(/referralCode=[^&\s#]+/gi, "referralCode=[redacted]");
  return out;
}

export function assessReferralUrl(jobId: string, rawUrl: string | null): ReferralUrlAssessment {
  const invalid: ReferralUrlAssessment = {
    hostIsJobsMicro1: false,
    pathContainsJobId: false,
    hasReferralCodeParam: false,
    structurallyValid: false,
    redactedShape: "unparseable",
  };
  if (!rawUrl) return invalid;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return invalid;
  }

  const hostIsJobsMicro1 = parsed.hostname.toLowerCase() === "jobs.micro1.ai";
  const decodedPath = decodeURIComponent(parsed.pathname);
  const pathContainsJobId = jobId.length > 0 && decodedPath.includes(jobId);
  const referralCode = parsed.searchParams.get("referralCode");
  const hasReferralCodeParam = referralCode !== null && referralCode.trim().length > 0;
  const path = pathContainsJobId ? decodedPath.split(jobId).join("{jobId}") : decodedPath;
  const queryKeys = [...parsed.searchParams.keys()];
  const redactedShape = `${parsed.protocol}//${parsed.hostname}${path}${queryKeys.length > 0 ? `?${queryKeys.join("&")}` : ""}`;

  return {
    hostIsJobsMicro1,
    pathContainsJobId,
    hasReferralCodeParam,
    structurallyValid: hostIsJobsMicro1 && pathContainsJobId && hasReferralCodeParam,
    redactedShape,
  };
}

function parseEnvelope(payload: unknown): { total: number | null; rows: unknown[] | null; error: string | null } {
  const body = asRecord(payload);
  if (!body) return { total: null, rows: null, error: "response was not an object" };
  if (!Array.isArray(body.data)) return { total: null, rows: null, error: "response did not include a data array" };
  const total = body.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    return { total: null, rows: body.data, error: "response did not include a numeric total" };
  }
  return { total, rows: body.data, error: null };
}

function parseRow(row: unknown): ParsedRow {
  const record = asRecord(row);
  if (!record || !("job_id" in record)) {
    return { jobId: null, invalidReason: "missing job_id", applyUrl: null };
  }
  if (typeof record.job_id !== "string") {
    return { jobId: null, invalidReason: "non-string job_id", applyUrl: null };
  }
  const jobId = record.job_id.trim();
  if (!jobId) return { jobId: null, invalidReason: "empty job_id", applyUrl: null };
  const applyUrl = typeof record.apply_url === "string" ? record.apply_url : null;
  return { jobId, invalidReason: null, applyUrl };
}

function failureMessage(error: unknown, secrets: readonly string[]): string {
  const message = error instanceof Error ? error.message : "referral request failed";
  return sanitizeDiagnosticText(message, secrets);
}

/**
 * Read the authenticated eligible-jobs feed. Completeness requires every page
 * to report the same total and the collected row count to equal that total.
 * A short page is not treated as proof that the feed ended.
 */
export async function captureReferralInventory(
  fetchPage: ReferralInventoryFetcher,
  options: {
    capturedAt?: string;
    pageLimit?: number;
    maxPages?: number;
    redactSecrets?: readonly string[];
  } = {},
): Promise<ReferralInventoryCapture> {
  const pageLimit = options.pageLimit ?? REFERRAL_INVENTORY_PAGE_LIMIT;
  const maxPages = options.maxPages ?? REFERRAL_INVENTORY_MAX_PAGES;
  const secrets = options.redactSecrets ?? [];
  const pages: ReferralInventoryPage[] = [];
  const invalidRows: ReferralInventoryInvalidRow[] = [];
  const failures: ReferralInventoryFailure[] = [];
  const notes: string[] = [];
  const seen = new Map<string, SeenJob>();
  let reportedTotal: number | null = null;
  let rawCount = 0;
  let inconsistent = false;

  function note(message: string) {
    if (!notes.includes(message)) notes.push(message);
  }

  for (let page = 1; page <= maxPages; page++) {
    let payload: unknown;
    try {
      payload = await fetchPage(page, pageLimit);
    } catch (error) {
      failures.push({ page, message: failureMessage(error, secrets) });
      note(`page ${page} request failed`);
      break;
    }

    const envelope = parseEnvelope(payload);
    pages.push({ page, rowCount: envelope.rows?.length ?? 0, reportedTotal: envelope.total });

    if (envelope.error || envelope.total === null || envelope.rows === null) {
      inconsistent = true;
      note(`page ${page} pagination was inconsistent: ${envelope.error ?? "missing total"}`);
      break;
    }

    if (reportedTotal === null) {
      reportedTotal = envelope.total;
    } else if (envelope.total !== reportedTotal) {
      inconsistent = true;
      note(`page ${page} reported total ${envelope.total} after page 1 reported ${reportedTotal}`);
      break;
    }

    if (envelope.rows.length > pageLimit) {
      inconsistent = true;
      note(`page ${page} returned ${envelope.rows.length} rows, above the requested limit ${pageLimit}`);
      break;
    }

    for (let index = 0; index < envelope.rows.length; index++) {
      const parsed = parseRow(envelope.rows[index]);
      rawCount++;
      if (parsed.invalidReason || !parsed.jobId) {
        invalidRows.push({
          page,
          index,
          reason: parsed.invalidReason ?? "missing job_id",
        });
        continue;
      }

      const assessment = assessReferralUrl(parsed.jobId, parsed.applyUrl);
      const existing = seen.get(parsed.jobId);
      if (!existing) {
        seen.set(parsed.jobId, {
          count: 1,
          job: {
            jobId: parsed.jobId,
            referralUrl: assessment,
            referralShapeConflict: false,
          },
        });
        continue;
      }

      existing.count++;
      if (existing.job.referralUrl.redactedShape !== assessment.redactedShape) {
        existing.job.referralShapeConflict = true;
      }
    }

    if (rawCount === reportedTotal) {
      note("collected row count matched the source-reported total");
      break;
    }

    if (rawCount > reportedTotal) {
      inconsistent = true;
      note(`collected ${rawCount} rows, above the source-reported total ${reportedTotal}`);
      break;
    }

    if (envelope.rows.length === 0 || envelope.rows.length < pageLimit) {
      inconsistent = true;
      note(
        `stopped on a short page (${envelope.rows.length} rows) before reaching reported total ${reportedTotal}; a short page is not treated as a complete inventory`,
      );
      break;
    }

    if (page === maxPages) {
      inconsistent = true;
      note(`stopped at the page safety limit ${maxPages} before reaching reported total ${reportedTotal}`);
    }
  }

  if (invalidRows.length > 0) {
    inconsistent = true;
    note(`${invalidRows.length} rows had a missing or invalid job_id`);
  }

  const duplicateIds = [...seen.values()]
    .filter((entry) => entry.count > 1)
    .map((entry) => entry.job.jobId)
    .sort();

  if (failures.length === 0 && !inconsistent && reportedTotal !== null && rawCount === reportedTotal) {
    note("eligible-jobs pagination matched the reported total");
  }

  const inventoryComplete = failures.length === 0 && !inconsistent && reportedTotal !== null && rawCount === reportedTotal;

  return {
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    request: {
      method: "GET",
      path: REFERRAL_INVENTORY_PATH,
      pageLimit,
    },
    reportedTotal,
    pages,
    pagesFetched: pages.length,
    rawCount,
    uniqueCount: seen.size,
    duplicateIds,
    invalidRows,
    failures,
    inventoryComplete,
    completionNotes: notes,
    jobs: [...seen.values()].map((entry) => entry.job),
  };
}
