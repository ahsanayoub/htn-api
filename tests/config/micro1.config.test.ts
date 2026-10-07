import { describe, it, expect, afterEach } from "vitest";
import {
  clampMicro1EligibleJobsLimit,
  getMicro1DiscoverySource,
  getMicro1ReferralAccessToken,
  MICRO1_ELIGIBLE_JOBS_PAGE_LIMIT,
} from "../../src/config/micro1.config.js";

afterEach(() => {
  delete process.env.MICRO1_DISCOVERY_SOURCE;
  delete process.env.MICRO1_REFERRAL_ACCESS_TOKEN;
});

describe("micro1.config", () => {
  it("defaults discovery source to public", () => {
    expect(getMicro1DiscoverySource({})).toBe("public");
  });

  it("accepts referral / public / existing aliases", () => {
    expect(getMicro1DiscoverySource({ MICRO1_DISCOVERY_SOURCE: "referral" })).toBe(
      "referral",
    );
    expect(getMicro1DiscoverySource({ MICRO1_DISCOVERY_SOURCE: "public" })).toBe(
      "public",
    );
    expect(getMicro1DiscoverySource({ MICRO1_DISCOVERY_SOURCE: "existing" })).toBe(
      "public",
    );
    expect(getMicro1DiscoverySource({ MICRO1_DISCOVERY_SOURCE: "REFERRAL" })).toBe(
      "referral",
    );
  });

  it("reads referral access token without trimming secrets into logs", () => {
    expect(getMicro1ReferralAccessToken({})).toBeUndefined();
    expect(
      getMicro1ReferralAccessToken({ MICRO1_REFERRAL_ACCESS_TOKEN: "  tok-abc  " }),
    ).toBe("tok-abc");
  });

  it("clamps eligible-jobs limit to 1..100", () => {
    expect(clampMicro1EligibleJobsLimit(100)).toBe(100);
    expect(clampMicro1EligibleJobsLimit(101)).toBe(100);
    expect(clampMicro1EligibleJobsLimit(0)).toBe(1);
    expect(clampMicro1EligibleJobsLimit(-5)).toBe(1);
    expect(clampMicro1EligibleJobsLimit(NaN)).toBe(MICRO1_ELIGIBLE_JOBS_PAGE_LIMIT);
    expect(MICRO1_ELIGIBLE_JOBS_PAGE_LIMIT).toBe(100);
  });
});
