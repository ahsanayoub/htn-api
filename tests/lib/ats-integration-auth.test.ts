import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { isAtsIntegrationRequest } from "../../src/lib/ats-integration-auth.js";

describe("isAtsIntegrationRequest", () => {
  const ORIGINAL_KEY = process.env.HTN_ATS_INTEGRATION_KEY;

  beforeEach(() => {
    process.env.HTN_ATS_INTEGRATION_KEY = "test-integration-key";
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.HTN_ATS_INTEGRATION_KEY;
    else process.env.HTN_ATS_INTEGRATION_KEY = ORIGINAL_KEY;
  });

  it("accepts a valid Bearer integration key", () => {
    expect(isAtsIntegrationRequest("Bearer test-integration-key")).toBe(true);
  });

  it("rejects missing, wrong, or empty credentials without throwing", () => {
    expect(isAtsIntegrationRequest(undefined)).toBe(false);
    expect(isAtsIntegrationRequest(null)).toBe(false);
    expect(isAtsIntegrationRequest("")).toBe(false);
    expect(isAtsIntegrationRequest("Bearer wrong-key")).toBe(false);
    expect(isAtsIntegrationRequest("Basic test-integration-key")).toBe(false);
  });

  it("returns false when the integration key is not configured", () => {
    delete process.env.HTN_ATS_INTEGRATION_KEY;
    expect(isAtsIntegrationRequest("Bearer test-integration-key")).toBe(false);
  });
});
