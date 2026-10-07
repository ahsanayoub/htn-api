import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JobSource } from "@prisma/client";

import { Micro1SyncAdapter } from "../../src/adapters/micro1.adapter.js";
import type { Micro1Client } from "../../src/clients/micro1.client.js";
import type { Micro1Processor } from "../../src/processors/micro1.processor.js";
import type { HTNJob } from "../../src/models/htn-job.model.js";
import type { Micro1JobSummaryDTO } from "../../src/dto/micro1-job-summary.dto.js";

const REFERRAL_APPLY_URL =
  "https://jobs.micro1.ai/post/job-aaa?referralCode=rc123&utm_source=referral&utm_medium=share";

function summaryDto(
  overrides: Partial<Micro1JobSummaryDTO> & { job_id: string },
): Micro1JobSummaryDTO {
  return {
    job_name: `Title ${overrides.job_id}`,
    company_name: "Acme",
    date_posted: "2026-01-01",
    skills: [],
    role_type: "EXPERT",
    domain_slug: "eng",
    job_type: "CONTRACT",
    apply_url: `https://jobs.micro1.ai/post/${overrides.job_id}?referralCode=rc123&utm_source=referral`,
    location_type: "Remote",
    engagement_type: null,
    ...overrides,
  };
}

function baseJob(overrides: Partial<HTNJob> = {}): HTNJob {
  return {
    id: "hash",
    source: "micro1",
    externalId: "job-aaa",
    sourceUrl: undefined,
    title: "Engineer",
    company: { name: "Acme", id: "org-1" },
    description: "desc",
    content: {
      summary: "s",
      responsibilities: [],
      requirements: [],
      preferredQualifications: [],
      benefits: [],
      additionalSections: {},
    },
    location: { name: "Remote", workModel: "Remote", countries: ["US"] },
    employmentType: "CONTRACT",
    status: "open",
    skills: [],
    screeningQuestions: [],
    metadata: {},
    directApply: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("Micro1SyncAdapter referral discovery", () => {
  const syncStart = new Date("2026-10-07T12:00:00.000Z");
  let getEligibleJobs: ReturnType<typeof vi.fn>;
  let getJobs: ReturnType<typeof vi.fn>;
  let processJob: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.MICRO1_DISCOVERY_SOURCE = "referral";
    process.env.MICRO1_REFERRAL_ACCESS_TOKEN = "test-token";
    getEligibleJobs = vi.fn();
    getJobs = vi.fn();
    processJob = vi.fn();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.MICRO1_DISCOVERY_SOURCE;
    delete process.env.MICRO1_REFERRAL_ACCESS_TOKEN;
    logSpy.mockRestore();
  });

  function adapter() {
    return new Micro1SyncAdapter(
      { getEligibleJobs, getJobs } as unknown as Micro1Client,
      { process: processJob } as unknown as Micro1Processor,
    );
  }

  it("paginates page 1, 2, final page with limit 100 and stops on empty page", async () => {
    getEligibleJobs
      .mockResolvedValueOnce({
        total: 205,
        data: Array.from({ length: 100 }, (_, i) =>
          summaryDto({ job_id: `p1-${i}` }),
        ),
      })
      .mockResolvedValueOnce({
        total: 205,
        data: Array.from({ length: 100 }, (_, i) =>
          summaryDto({ job_id: `p2-${i}` }),
        ),
      })
      .mockResolvedValueOnce({
        total: 205,
        data: Array.from({ length: 5 }, (_, i) =>
          summaryDto({ job_id: `p3-${i}` }),
        ),
      });

    const summaries = await adapter().getJobSummaries(syncStart);

    expect(getEligibleJobs).toHaveBeenCalledTimes(3);
    expect(getEligibleJobs).toHaveBeenNthCalledWith(1, 1, 100);
    expect(getEligibleJobs).toHaveBeenNthCalledWith(2, 2, 100);
    expect(getEligibleJobs).toHaveBeenNthCalledWith(3, 3, 100);
    expect(summaries).toHaveLength(205);
    expect(getJobs).not.toHaveBeenCalled();
  });

  it("stops safely when a subsequent page returns empty data", async () => {
    getEligibleJobs
      .mockResolvedValueOnce({
        total: 150,
        data: Array.from({ length: 100 }, (_, i) =>
          summaryDto({ job_id: `full-${i}` }),
        ),
      })
      .mockResolvedValueOnce({
        total: 150,
        data: [],
      });

    const summaries = await adapter().getJobSummaries(syncStart);

    expect(getEligibleJobs).toHaveBeenCalledTimes(2);
    expect(summaries).toHaveLength(100);
  });

  it("stops when accumulated results reach reported total", async () => {
    getEligibleJobs.mockResolvedValueOnce({
      total: 100,
      data: Array.from({ length: 100 }, (_, i) =>
        summaryDto({ job_id: `t-${i}` }),
      ),
    });

    const summaries = await adapter().getJobSummaries(syncStart);

    expect(getEligibleJobs).toHaveBeenCalledTimes(1);
    expect(summaries).toHaveLength(100);
  });

  it("maps job_id → externalId and apply_url → referralUrl (fetch URL)", async () => {
    getEligibleJobs.mockResolvedValueOnce({
      total: 1,
      data: [
        summaryDto({
          job_id: "job-aaa",
          job_name: "Senior Eng",
          company_name: "MicroCo",
          apply_url: REFERRAL_APPLY_URL,
        }),
      ],
    });

    const summaries = await adapter().getJobSummaries(syncStart);

    expect(summaries).toEqual([
      {
        externalId: "job-aaa",
        title: "Senior Eng",
        companyName: "MicroCo",
        applyUrl: REFERRAL_APPLY_URL,
        referralUrl: REFERRAL_APPLY_URL,
      },
    ]);
    expect(summaries[0].referralUrl).toContain("referralCode=rc123");
  });

  it("deduplicates summaries by job_id before processing", async () => {
    getEligibleJobs.mockResolvedValueOnce({
      total: 3,
      data: [
        summaryDto({ job_id: "dup", apply_url: REFERRAL_APPLY_URL }),
        summaryDto({ job_id: "dup", apply_url: REFERRAL_APPLY_URL }),
        summaryDto({ job_id: "unique" }),
      ],
    });

    const summaries = await adapter().getJobSummaries(syncStart);

    expect(summaries).toHaveLength(2);
    expect(summaries.map((s) => s.externalId).sort()).toEqual(["dup", "unique"]);

    const logs = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logs).toContain("Micro1 eligible jobs discovered: 2");
    expect(logs).toContain("Micro1 pages fetched: 1");
    expect(logs).toContain("Micro1 duplicate summaries removed: 1");
  });

  it("fetches detail via apply_url but persists referralUrl, not applyUrl/canonicalUrl", async () => {
    processJob.mockResolvedValue(
      baseJob({
        sourceUrl: "https://jobs.micro1.ai/post/job-aaa",
        externalId: "job-aaa",
      }),
    );

    const job = await adapter().getJobDetails({
      applyUrl: REFERRAL_APPLY_URL,
      referralUrl: REFERRAL_APPLY_URL,
      title: "Senior Eng",
      companyName: "MicroCo",
      externalId: "job-aaa",
    });

    expect(processJob).toHaveBeenCalledWith(REFERRAL_APPLY_URL);
    expect(job.referralUrl).toBe(REFERRAL_APPLY_URL);
    expect(job.referralUrl).toContain("referralCode=rc123");
    expect(job.externalId).toBe("job-aaa");
    // Referral path must not reattach feed URL onto sourceUrl (legacy apply mapping).
    expect(job.sourceUrl).toBe("https://jobs.micro1.ai/post/job-aaa");

    const upsert = adapter().mapToUpsertData(job, "org", syncStart);
    expect(upsert.referralUrl).toBe(REFERRAL_APPLY_URL);
    expect(upsert.referralUrl).toContain("referralCode=rc123");
    expect(upsert.applyUrl).toBeUndefined();
    expect(upsert.canonicalUrl).toBeUndefined();
    expect(upsert.source).toBe(JobSource.MICRO1);
    expect(upsert.externalId).toBe("job-aaa");
  });

  it("detail processing cannot overwrite summary referralUrl", async () => {
    processJob.mockResolvedValue(
      baseJob({
        referralUrl: "https://evil.example/overwrite",
        sourceUrl: "https://jobs.micro1.ai/post/parser-only",
      }),
    );

    const job = await adapter().getJobDetails({
      applyUrl: REFERRAL_APPLY_URL,
      referralUrl: REFERRAL_APPLY_URL,
      title: "Senior Eng",
      companyName: "MicroCo",
      externalId: "job-aaa",
    });

    expect(job.referralUrl).toBe(REFERRAL_APPLY_URL);

    const upsert = adapter().mapToUpsertData(job, "org", syncStart);
    expect(upsert.referralUrl).toBe(REFERRAL_APPLY_URL);
    expect(upsert.applyUrl).toBeUndefined();
    expect(upsert.canonicalUrl).toBeUndefined();
  });

  it("does not synthesize an HTN careers apply URL", async () => {
    processJob.mockResolvedValue(baseJob({ sourceUrl: undefined }));

    const job = await adapter().getJobDetails({
      applyUrl: REFERRAL_APPLY_URL,
      referralUrl: REFERRAL_APPLY_URL,
      title: "Senior Eng",
      companyName: "MicroCo",
      externalId: "job-aaa",
    });
    const upsert = adapter().mapToUpsertData(job, "org", syncStart);

    expect(upsert.applyUrl).toBeUndefined();
    expect(JSON.stringify(upsert)).not.toMatch(/apply\.html/);
    expect(JSON.stringify(upsert)).not.toMatch(/careers/i);
  });

  it("falls back to summary.externalId when detail parser omits it", async () => {
    processJob.mockResolvedValue(baseJob({ externalId: "" as unknown as string }));

    const job = await adapter().getJobDetails({
      applyUrl: REFERRAL_APPLY_URL,
      referralUrl: REFERRAL_APPLY_URL,
      title: "Senior Eng",
      companyName: "MicroCo",
      externalId: "job-aaa",
    });

    expect(job.externalId).toBe("job-aaa");
  });

  it("propagates eligible-jobs failures (does not treat as empty success)", async () => {
    getEligibleJobs.mockRejectedValueOnce(
      new Error("Micro1 referral authentication failed"),
    );

    await expect(adapter().getJobSummaries(syncStart)).rejects.toThrow(
      "Micro1 referral authentication failed",
    );
  });

  it("uses legacy getJobs when discovery source is public (no referralUrl)", async () => {
    process.env.MICRO1_DISCOVERY_SOURCE = "public";
    getJobs.mockResolvedValueOnce({
      total: 1,
      data: [
        summaryDto({
          job_id: "pub-1",
          job_name: "Public Role",
          company_name: "PubCo",
          apply_url: "https://jobs.micro1.ai/post/pub-1",
        }),
      ],
    });

    const summaries = await adapter().getJobSummaries(syncStart);

    expect(getJobs).toHaveBeenCalledTimes(1);
    expect(getEligibleJobs).not.toHaveBeenCalled();
    expect(summaries[0]).toEqual({
      externalId: "pub-1",
      title: "Public Role",
      companyName: "PubCo",
      applyUrl: "https://jobs.micro1.ai/post/pub-1",
    });
    expect(summaries[0].referralUrl).toBeUndefined();

    processJob.mockResolvedValue(baseJob({ externalId: "pub-1", sourceUrl: undefined }));
    const job = await adapter().getJobDetails(summaries[0]);
    const upsert = adapter().mapToUpsertData(job, "org", syncStart);

    expect(upsert.applyUrl).toBe("https://jobs.micro1.ai/post/pub-1");
    expect(upsert.canonicalUrl).toBe("https://jobs.micro1.ai/post/pub-1");
    expect(upsert.referralUrl).toBeUndefined();
  });

  it("returns empty array on successful zero-result referral crawl (does not throw)", async () => {
    getEligibleJobs.mockResolvedValueOnce({ total: 0, data: [] });

    const summaries = await adapter().getJobSummaries(syncStart);

    expect(summaries).toEqual([]);
    expect(getEligibleJobs).toHaveBeenCalledTimes(1);
  });

  it("exposes only MICRO1 as adapter source (stale closure cannot target MANUAL/OTHER)", () => {
    expect(adapter().source).toBe(JobSource.MICRO1);
    expect(adapter().source).not.toBe(JobSource.MANUAL);
    expect(adapter().source).not.toBe(JobSource.OTHER);
  });
});
