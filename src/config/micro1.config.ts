/**
 * Micro1 job discovery configuration.
 *
 * MICRO1_DISCOVERY_SOURCE:
 *   - "referral" — authenticated Referral Dashboard eligible-jobs feed
 *   - "public" | "existing" — legacy POST /job/portal get_all_jobs (EXPERT)
 *
 * Default is "public" so production behavior is unchanged until explicitly opted in.
 *
 * MICRO1_REFERRAL_ACCESS_TOKEN:
 *   Bearer token for GET /referral/portal/eligible-jobs.
 *   Required when discovery source is "referral". Never log this value.
 */

export type Micro1DiscoverySource = "referral" | "public";

export const MICRO1_ELIGIBLE_JOBS_PAGE_LIMIT = 100;

export function getMicro1DiscoverySource(
  env: NodeJS.ProcessEnv = process.env,
): Micro1DiscoverySource {
  const raw = env.MICRO1_DISCOVERY_SOURCE?.trim().toLowerCase();
  if (raw === "referral") return "referral";
  if (raw === "public" || raw === "existing") return "public";
  return "public";
}

export function getMicro1ReferralAccessToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const token = env.MICRO1_REFERRAL_ACCESS_TOKEN?.trim();
  return token ? token : undefined;
}

export function clampMicro1EligibleJobsLimit(limit: number): number {
  if (!Number.isFinite(limit)) return MICRO1_ELIGIBLE_JOBS_PAGE_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), MICRO1_ELIGIBLE_JOBS_PAGE_LIMIT);
}
