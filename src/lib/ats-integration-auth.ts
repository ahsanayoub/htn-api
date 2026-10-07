/**
 * Soft check for ATS integration Bearer credentials.
 * Used by public careers routes that optionally enrich the response for ATS sync
 * without rejecting anonymous callers.
 */
export function isAtsIntegrationRequest(authorization: unknown): boolean {
  const expected = process.env.HTN_ATS_INTEGRATION_KEY?.trim();
  if (!expected) return false;
  if (typeof authorization !== "string" || !authorization.trim()) return false;
  const supplied = authorization.replace(/^Bearer\s+/i, "").trim();
  return Boolean(supplied && supplied === expected);
}
