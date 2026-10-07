import { describe, it, expect, vi, beforeEach } from "vitest";
import { JobSource, JobStatus } from "@prisma/client";

const { mockUpsert, mockFindFirst, mockTransaction } = vi.hoisted(() => {
  const mockUpsert = vi.fn();
  const mockFindFirst = vi.fn();
  const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      job: {
        findFirst: mockFindFirst,
        upsert: mockUpsert,
      },
    };
    return fn(tx);
  });
  return { mockUpsert, mockFindFirst, mockTransaction };
});

vi.mock("../../src/prisma/client.js", () => ({
  default: {
    $transaction: mockTransaction,
    jobSkill: { deleteMany: vi.fn(), createMany: vi.fn() },
    skill: { upsert: vi.fn() },
  },
}));

import { JobRepository } from "../../src/repositories/job.repository.js";

describe("JobRepository referralUrl persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({ id: "job-row-id" });
  });

  it("persists referralUrl on create and does not require applyUrl", async () => {
    const repo = new JobRepository();
    const referralUrl =
      "https://jobs.micro1.ai/post/ext-1?referralCode=rc123&utm_source=referral";

    await repo.upsert({
      externalId: "ext-1",
      source: JobSource.MICRO1,
      title: "Engineer",
      organizationId: "11111111-1111-1111-1111-111111111111",
      referralUrl,
      status: JobStatus.ACTIVE,
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const args = mockUpsert.mock.calls[0][0];
    expect(args.create.referralUrl).toBe(referralUrl);
    expect(args.create.applyUrl).toBeUndefined();
    expect(args.create.canonicalUrl).toBeUndefined();
    // Update should include referralUrl when provided; omit applyUrl when undefined.
    expect(args.update.referralUrl).toBe(referralUrl);
    expect(args.update).not.toHaveProperty("applyUrl");
    expect(args.update).not.toHaveProperty("canonicalUrl");
  });

  it("leaves applyUrl/canonicalUrl untouched on update when omitted (other sources unchanged)", async () => {
    mockFindFirst.mockResolvedValue({ id: "existing" });
    const repo = new JobRepository();

    await repo.upsert({
      externalId: "manual-1",
      source: JobSource.MANUAL,
      title: "Manual Role",
      organizationId: "11111111-1111-1111-1111-111111111111",
      applyUrl: "https://headsbase.example/existing-apply",
      canonicalUrl: "https://headsbase.example/canonical",
    });

    const args = mockUpsert.mock.calls[0][0];
    expect(args.create.applyUrl).toBe("https://headsbase.example/existing-apply");
    expect(args.update.applyUrl).toBe("https://headsbase.example/existing-apply");
    expect(args.update.canonicalUrl).toBe("https://headsbase.example/canonical");
    expect(args.update).not.toHaveProperty("referralUrl");
  });
});
