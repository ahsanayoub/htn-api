import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JobSource, JobStatus } from "@prisma/client";

import { Micro1SyncAdapter } from "../../src/adapters/micro1.adapter.js";
import {
  shouldCloseJobsAbsentFromFeed,
  type SourceAdapter,
} from "../../src/adapters/source.adapter.js";
import type { Micro1Client } from "../../src/clients/micro1.client.js";
import type { HTNJob } from "../../src/models/htn-job.model.js";
import type { Micro1Processor } from "../../src/processors/micro1.processor.js";

function adapter(): Micro1SyncAdapter {
  return new Micro1SyncAdapter({} as Micro1Client, {} as Micro1Processor);
}

function job(status: string, referralUrl?: string): HTNJob {
  return {
    id: "hash",
    source: "micro1",
    externalId: "3ca164ec-a540-4f18-b298-09c54c377eb2",
    sourceUrl: "https://jobs.micro1.ai/post/3ca164ec-a540-4f18-b298-09c54c377eb2",
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
    status,
    skills: [],
    screeningQuestions: [],
    metadata: {},
    directApply: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...(referralUrl ? { referralUrl } : {}),
  } as HTNJob;
}

describe("Micro1 absence closure", () => {
  const original = process.env.MICRO1_DISCOVERY_SOURCE;

  afterEach(() => {
    if (original === undefined) delete process.env.MICRO1_DISCOVERY_SOURCE;
    else process.env.MICRO1_DISCOVERY_SOURCE = original;
  });

  it("does not close a Micro1 job missing from the public discovery feed", () => {
    process.env.MICRO1_DISCOVERY_SOURCE = "public";
    const micro1 = adapter();

    assert.equal(micro1.closesJobsAbsentFromFeed(), false);
    assert.equal(shouldCloseJobsAbsentFromFeed(micro1), false);
  });

  it("still ingests a returned public job with the existing status mapping and apply URL", () => {
    process.env.MICRO1_DISCOVERY_SOURCE = "public";
    const micro1 = adapter();
    const syncStart = new Date("2026-10-09T00:00:00.000Z");

    const openJob = micro1.mapToUpsertData(job("open"), "org-1", syncStart);
    assert.equal(openJob.externalId, "3ca164ec-a540-4f18-b298-09c54c377eb2");
    assert.equal(openJob.status, JobStatus.ACTIVE);
    assert.equal(openJob.applyUrl, "https://jobs.micro1.ai/post/3ca164ec-a540-4f18-b298-09c54c377eb2");
    assert.equal(openJob.canonicalUrl, "https://jobs.micro1.ai/post/3ca164ec-a540-4f18-b298-09c54c377eb2");
    assert.equal(openJob.referralUrl, undefined);

    assert.equal(micro1.mapToUpsertData(job("closed"), "org-1", syncStart).status, JobStatus.CLOSED);
    assert.equal(micro1.mapToUpsertData(job("filled"), "org-1", syncStart).status, JobStatus.CLOSED);
    assert.equal(micro1.mapToUpsertData(job("expired"), "org-1", syncStart).status, JobStatus.CLOSED);
    assert.equal(micro1.mapToUpsertData(job("archived"), "org-1", syncStart).status, JobStatus.ARCHIVED);
    assert.equal(micro1.mapToUpsertData(job("paused"), "org-1", syncStart).status, JobStatus.ON_HOLD);
  });

  it("does not close a Micro1 job missing from the referral subset", () => {
    process.env.MICRO1_DISCOVERY_SOURCE = "referral";
    const micro1 = adapter();

    assert.equal(micro1.closesJobsAbsentFromFeed(), false);
    assert.equal(shouldCloseJobsAbsentFromFeed(micro1), false);
  });

  it("keeps absence closure for adapters that do not opt out", () => {
    const other = { source: JobSource.GREENHOUSE } as SourceAdapter;
    const explicit = {
      source: JobSource.LEVER,
      closesJobsAbsentFromFeed: () => true,
    } as SourceAdapter;

    assert.equal(shouldCloseJobsAbsentFromFeed(other), true);
    assert.equal(shouldCloseJobsAbsentFromFeed(explicit), true);
  });
});
