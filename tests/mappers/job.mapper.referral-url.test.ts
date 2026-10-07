import { describe, it, expect } from "vitest";
import { JobSource, JobStatus, JobVisibility, WorkplaceType } from "@prisma/client";

import { mapPrismaJobToApiJob } from "../../src/mappers/job.mapper.js";
import type { JobWithRelations } from "../../src/repositories/job.repository.js";

const FULL_REFERRAL_URL =
  "https://jobs.micro1.ai/post/3ca164ec-a540-4f18-b298-09c54c377eb2?referralCode=452891ab-aef5-4aaf-8258-92b549ba33c0&utm_source=referral&utm_medium=share&utm_campaign=job_referral";

function samplePrismaJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "internal-uuid",
    externalId: "3ca164ec-a540-4f18-b298-09c54c377eb2",
    title: "Engineer",
    description: "desc",
    employmentType: null,
    workplaceType: WorkplaceType.REMOTE,
    postedAt: new Date("2026-01-01T00:00:00.000Z"),
    applyUrl: "https://headsbase.example/apply/job-1",
    canonicalUrl: "https://headsbase.example/jobs/job-1",
    referralUrl: FULL_REFERRAL_URL,
    source: JobSource.MICRO1,
    status: JobStatus.ACTIVE,
    visibility: JobVisibility.PUBLIC,
    responsibilities: null,
    requirements: null,
    preferredQualifications: null,
    remote: true,
    organization: { id: "org", name: "Acme", externalId: null },
    jobSkills: [],
    ...overrides,
  } as unknown as JobWithRelations;
}

describe("mapPrismaJobToApiJob referralUrl protection", () => {
  it("does not expose referralUrl on the public careers job DTO", () => {
    const apiJob = mapPrismaJobToApiJob(samplePrismaJob());

    expect(apiJob.jobId).toBe("3ca164ec-a540-4f18-b298-09c54c377eb2");
    expect(apiJob.applyUrl).toBe("https://headsbase.example/apply/job-1");
    expect(apiJob).not.toHaveProperty("referralUrl");
    expect(JSON.stringify(apiJob)).not.toContain("referralCode=");
    expect(JSON.stringify(apiJob)).not.toContain("referralUrl");
  });

  it("includes the exact referralUrl when ATS includeReferralUrl is requested", () => {
    const apiJob = mapPrismaJobToApiJob(samplePrismaJob(), { includeReferralUrl: true });

    expect(apiJob.referralUrl).toBe(FULL_REFERRAL_URL);
    expect(apiJob.applyUrl).toBe("https://headsbase.example/apply/job-1");
    // Public/ATS careers DTO never maps canonicalUrl; it stays a DB-only field.
    expect(apiJob).not.toHaveProperty("canonicalUrl");
  });

  it("does not invent referralUrl when DB value is null", () => {
    const apiJob = mapPrismaJobToApiJob(samplePrismaJob({ referralUrl: null }), {
      includeReferralUrl: true,
    });

    expect(apiJob.referralUrl).toBeNull();
    expect(apiJob.applyUrl).toBe("https://headsbase.example/apply/job-1");
  });

  it("leaves applyUrl unchanged when including referralUrl", () => {
    const applyUrl = "https://headsbase.example/careers/apply/keep-me";
    const apiJob = mapPrismaJobToApiJob(samplePrismaJob({ applyUrl }), {
      includeReferralUrl: true,
    });

    expect(apiJob.applyUrl).toBe(applyUrl);
    expect(apiJob.referralUrl).toBe(FULL_REFERRAL_URL);
    expect(apiJob.applyUrl).not.toBe(apiJob.referralUrl);
  });
});
