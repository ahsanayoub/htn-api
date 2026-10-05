import { describe, it, expect, vi } from "vitest";
import { JobSource, JobStatus } from "@prisma/client";

import { Micro1SyncAdapter } from "../../src/adapters/micro1.adapter.js";
import type { Micro1Processor } from "../../src/processors/micro1.processor.js";
import type { Micro1Client } from "../../src/clients/micro1.client.js";
import type { HTNJob } from "../../src/models/htn-job.model.js";
import type { SourceJobSummary } from "../../src/adapters/source.adapter.js";

const APPLY_URL_WITH_QUERY =
  "https://jobs.micro1.ai/post/b7222393-60d2-4a14-b038-52eb7493c50b?ref=partner&utm_source=htn";

function baseJob(overrides: Partial<HTNJob> = {}): HTNJob {
  return {
    id: "hash",
    source: "micro1",
    externalId: "b7222393-60d2-4a14-b038-52eb7493c50b",
    // Simulates parser/mapper leaving sourceUrl unset (canonicalUrl undefined).
    sourceUrl: undefined,
    title: "Litigation Attorney",
    company: { name: "micro1", id: "org-1" },
    description: "Job description",
    content: {
      summary: "Summary",
      responsibilities: ["Do work"],
      requirements: ["Req"],
      preferredQualifications: [],
      benefits: [],
      additionalSections: {},
    },
    location: { name: "Remote", workModel: "Remote", countries: ["United States"] },
    employmentType: "CONTRACT",
    status: "open",
    skills: ["Law"],
    screeningQuestions: [],
    metadata: {},
    directApply: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("Micro1SyncAdapter apply URL persistence", () => {
  const syncStart = new Date("2026-10-05T19:00:00.000Z");
  const summary: SourceJobSummary = {
    applyUrl: APPLY_URL_WITH_QUERY,
    title: "Litigation Attorney",
    companyName: "micro1",
  };

  it("preserves summary.apply_url onto HTNJob.sourceUrl after detail processing", async () => {
    const process = vi.fn().mockResolvedValue(baseJob());
    const adapter = new Micro1SyncAdapter(
      {} as Micro1Client,
      { process } as unknown as Micro1Processor,
    );

    const job = await adapter.getJobDetails(summary);

    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith(APPLY_URL_WITH_QUERY);
    expect(job.sourceUrl).toBe(APPLY_URL_WITH_QUERY);
    // Query/referral params must be unchanged (no reconstruction from externalId).
    expect(job.sourceUrl).toContain("?ref=partner&utm_source=htn");
    expect(job.sourceUrl).not.toBe(
      `https://jobs.micro1.ai/post/${job.externalId}`,
    );
  });

  it("maps sourceUrl into upsert applyUrl and canonicalUrl exactly", async () => {
    const process = vi.fn().mockResolvedValue(baseJob());
    const adapter = new Micro1SyncAdapter(
      {} as Micro1Client,
      { process } as unknown as Micro1Processor,
    );

    const job = await adapter.getJobDetails(summary);
    const upsert = adapter.mapToUpsertData(job, "org-uuid", syncStart);

    expect(upsert.applyUrl).toBe(APPLY_URL_WITH_QUERY);
    expect(upsert.canonicalUrl).toBe(APPLY_URL_WITH_QUERY);
    expect(upsert.applyUrl).toBe(summary.applyUrl);
    expect(upsert.canonicalUrl).toBe(summary.applyUrl);
  });

  it("does not alter source/status/visibility mapping behavior", async () => {
    const process = vi.fn().mockResolvedValue(baseJob({ status: "open" }));
    const adapter = new Micro1SyncAdapter(
      {} as Micro1Client,
      { process } as unknown as Micro1Processor,
    );

    const job = await adapter.getJobDetails(summary);
    const upsert = adapter.mapToUpsertData(job, "org-uuid", syncStart);

    expect(upsert.source).toBe(JobSource.MICRO1);
    expect(upsert.status).toBe(JobStatus.ACTIVE);
    // Adapter does not set visibility; repository default remains PUBLIC.
    expect(upsert.visibility).toBeUndefined();
    expect(upsert.externalId).toBe(job.externalId);
    expect(upsert.lastSeenAt).toEqual(syncStart);
    expect(upsert.lastSyncedAt).toEqual(syncStart);
  });

  it("overrides a null/undefined parser sourceUrl without changing other fields", async () => {
    const process = vi.fn().mockResolvedValue(
      baseJob({
        sourceUrl: undefined,
        title: "Keep My Title",
        externalId: "keep-ext-id",
      }),
    );
    const adapter = new Micro1SyncAdapter(
      {} as Micro1Client,
      { process } as unknown as Micro1Processor,
    );

    const job = await adapter.getJobDetails(summary);

    expect(job.title).toBe("Keep My Title");
    expect(job.externalId).toBe("keep-ext-id");
    expect(job.sourceUrl).toBe(APPLY_URL_WITH_QUERY);
  });
});
