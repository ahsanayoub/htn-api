import { describe, it, expect } from "vitest";
import { JobSource, JobStatus, JobVisibility, WorkplaceType } from "@prisma/client";

import { mapPrismaJobToApiJob } from "../../src/mappers/job.mapper.js";
import type { JobWithRelations } from "../../src/repositories/job.repository.js";

describe("mapPrismaJobToApiJob referralUrl protection", () => {
  it("does not expose referralUrl on the public careers job DTO", () => {
    const prismaJob = {
      id: "internal-uuid",
      externalId: "micro1-job-id",
      title: "Engineer",
      description: "desc",
      employmentType: null,
      workplaceType: WorkplaceType.REMOTE,
      postedAt: new Date("2026-01-01T00:00:00.000Z"),
      applyUrl: null,
      canonicalUrl: null,
      referralUrl:
        "https://jobs.micro1.ai/post/micro1-job-id?referralCode=secret&utm_source=referral",
      source: JobSource.MICRO1,
      status: JobStatus.ACTIVE,
      visibility: JobVisibility.PUBLIC,
      responsibilities: null,
      requirements: null,
      preferredQualifications: null,
      remote: true,
      organization: { id: "org", name: "Acme", externalId: null },
      jobSkills: [],
    } as unknown as JobWithRelations;

    const apiJob = mapPrismaJobToApiJob(prismaJob);

    expect(apiJob.jobId).toBe("micro1-job-id");
    expect(apiJob.applyUrl).toBe("");
    expect(apiJob).not.toHaveProperty("referralUrl");
    expect(JSON.stringify(apiJob)).not.toContain("referralCode=secret");
    expect(JSON.stringify(apiJob)).not.toContain("referralUrl");
  });
});
