import { AppError } from "../errors/app-error.js";

export const ATS_SYNC_RETRY_DELAYS_MS = [
  0,
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
] as const;

/** Total ATS sync attempts including the immediate first try. */
export const ATS_SYNC_MAX_ATTEMPTS_DEFAULT = 8;
export const ATS_SYNC_MAX_ATTEMPTS_ENV = "HTN_ATS_SYNC_MAX_ATTEMPTS";

export const ATS_SYNC_STALE_SYNCING_MS = 2 * 60_000;
export const ATS_SYNC_REQUEST_TIMEOUT_MS = 15_000;
export const ATS_SYNC_ERROR_MESSAGE_MAX = 2000;

export function resolveAtsSyncMaxAttempts(env: Record<string, string | undefined> = process.env): number {
  const raw = env[ATS_SYNC_MAX_ATTEMPTS_ENV]?.trim();
  if (!raw) return ATS_SYNC_MAX_ATTEMPTS_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return ATS_SYNC_MAX_ATTEMPTS_DEFAULT;
  return parsed;
}

export function hasReachedAtsSyncRetryCeiling(
  attemptCount: number,
  maxAttempts = resolveAtsSyncMaxAttempts(),
): boolean {
  return attemptCount >= maxAttempts;
}

export type AtsFailureClass = {
  retryable: boolean;
  code: string;
  message: string;
  httpStatus?: number;
};

function truncateError(message: string): string {
  return message.length > ATS_SYNC_ERROR_MESSAGE_MAX
    ? message.slice(0, ATS_SYNC_ERROR_MESSAGE_MAX)
    : message;
}

function classifyHttpStatus(status: number, message: string): AtsFailureClass {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) {
    return {
      retryable: false,
      code: `HTTP_${status}`,
      message,
      httpStatus: status,
    };
  }
  if (status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599)) {
    return {
      retryable: true,
      code: `HTTP_${status}`,
      message,
      httpStatus: status,
    };
  }
  if (status >= 400 && status <= 499) {
    return {
      retryable: false,
      code: `HTTP_${status}`,
      message,
      httpStatus: status,
    };
  }
  return {
    retryable: true,
    code: `HTTP_${status}`,
    message,
    httpStatus: status,
  };
}

/**
 * Classify ATS sync failures.
 *
 * Permanent (do not retry):
 * - HTTP 400 malformed payload
 * - HTTP 401 unauthorized integration key
 * - HTTP 403 forbidden
 * - HTTP 404, including ATS JOB_NOT_FOUND. Other 404s are treated as
 *   permanent because the ATS contract does not distinguish a missing job
 *   from a missing route.
 * - HTTP 422 validation
 * - other 4xx except the retryable subset below
 * - HTN VALIDATION_ERROR (e.g. non-recruiter source)
 *
 * Retryable:
 * - network / connection / DNS failures
 * - AbortError / TimeoutError
 * - HTTP 408, 409, 425, 429
 * - HTTP 5xx, including a 502/503 from ATS or a reverse proxy
 * - INTEGRATION_NOT_CONFIGURED (503): local URL/key may be deployed later
 * - ATS_SYNC_INVALID_RESPONSE: a 2xx body missing required IDs is ambiguous
 *   (could be a transient HTML/proxy page) so it is retried
 */
export function classifyAtsSyncFailure(error: unknown): AtsFailureClass {
  if (error instanceof AppError) {
    if (error.code === "INTEGRATION_NOT_CONFIGURED") {
      return {
        retryable: true,
        code: error.code,
        message: truncateError(error.message),
        httpStatus: error.statusCode,
      };
    }
    if (error.code === "VALIDATION_ERROR") {
      return {
        retryable: false,
        code: error.code,
        message: truncateError(error.message),
        httpStatus: error.statusCode,
      };
    }
    if (error.code === "ATS_SYNC_INVALID_RESPONSE") {
      return {
        retryable: true,
        code: error.code,
        message: truncateError(error.message),
        httpStatus: error.statusCode,
      };
    }
    if (error.code === "ATS_SYNC_FAILED") {
      return classifyHttpStatus(error.statusCode, truncateError(error.message));
    }
    if (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408 && error.statusCode !== 429) {
      return {
        retryable: false,
        code: error.code,
        message: truncateError(error.message),
        httpStatus: error.statusCode,
      };
    }
    return {
      retryable: true,
      code: error.code,
      message: truncateError(error.message),
      httpStatus: error.statusCode,
    };
  }

  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") {
    return {
      retryable: true,
      code: "TIMEOUT",
      message: truncateError(error instanceof Error ? error.message : "ATS request timed out"),
    };
  }

  if (error instanceof TypeError || (error instanceof Error && /fetch|network|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(error.message))) {
    return {
      retryable: true,
      code: "NETWORK",
      message: truncateError(error instanceof Error ? error.message : "Network error"),
    };
  }

  return {
    retryable: true,
    code: "UNKNOWN",
    message: truncateError(error instanceof Error ? error.message : String(error)),
  };
}

export function nextRetryAt(attemptCount: number, now = new Date()): Date {
  const index = Math.min(Math.max(attemptCount, 0), ATS_SYNC_RETRY_DELAYS_MS.length - 1);
  return new Date(now.getTime() + ATS_SYNC_RETRY_DELAYS_MS[index]);
}
