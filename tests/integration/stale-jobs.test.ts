import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { JobSource, JobStatus } from "@prisma/client";
import prisma from "../../src/prisma/client.js";
import { SourceSyncService } from "../../src/services/sync.service.js";

import type { SourceAdapter, SourceJobSummary } from "../../src/adapters/source.adapter.js";
import type { HTNJob } from "../../src/models/htn-job.model.js";
import type { JobUpsertData } from "../../src/repositories/job.repository.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

// Fixed dates that are safely in the past relative to any real syncStart
const STALE_DATE = new Date("2026-08-10T00:00:00.000Z");

const createdOrganizationIds: string[] = [];
const createdJobIds: string[] = [];

async function cleanupJobs() {
  if (createdJobIds.length > 0) {
    await prisma.job.deleteMany({ where: { id: { in: createdJobIds } } }).catch(() => {});
    createdJobIds.length = 0;
  }
}

async function cleanupAll() {
  await cleanupJobs();
  if (createdOrganizationIds.length > 0) {
    await prisma.organization
      .deleteMany({ where: { id: { in: createdOrganizationIds } } })
      .catch(() => {});
    createdOrganizationIds.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Mock adapter for integration tests: implements SourceAdapter but returns
// controlled summaries / details / upsert data.
// ---------------------------------------------------------------------------

function createMockHTNJob(externalId: string, title: string): HTNJob {
  return {
    id: externalId,
    source: "micro1",
    externalId,
    title,
    company: { name: "Test Co" },
    description: "",
    content: {
      responsibilities: [],
      requirements: [],
      preferredQualifications: [],
      benefits: [],
      additionalSections: {},
    },
    skills: [],
    screeningQuestions: [],
    metadata: {},
    directApply: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

class TestAdapter implements SourceAdapter {
  readonly source = JobSource.MICRO1;
  summaries: SourceJobSummary[] = [];

  async getJobSummaries(_syncStart: Date): Promise<SourceJobSummary[]> {
    return this.summaries;
  }

  async getJobDetails(summary: SourceJobSummary): Promise<HTNJob> {
    return createMockHTNJob(summary.applyUrl, summary.title);
  }

  mapToUpsertData(
    job: HTNJob,
    organizationId: string,
    syncStart: Date,
  ): JobUpsertData {
    return {
      externalId: job.externalId,
      source: JobSource.MICRO1,
      title: job.title,
      organizationId,
      status: JobStatus.IMPORTED,
      lastSeenAt: syncStart,
      lastSyncedAt: syncStart,
      metadata: {},
    };
  }
}

// A non-stale summary so that sync() has at least one job to process and
// stale detection is allowed to run.
const CURRENT_SUMMARY: SourceJobSummary = {
  applyUrl: "int-current",
  title: "Current Job",
  companyName: "Test Co",
};

// ---------------------------------------------------------------------------
// Integration tests: stale-closing through SourceSyncService.sync()
// ---------------------------------------------------------------------------

suite("SourceSyncService stale-job closure (integration)", () => {
  const adapter = new TestAdapter();
  const service = new SourceSyncService(adapter);

  let orgId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Org for Stale Jobs", type: "COMPANY" },
    });
    orgId = org.id;
    createdOrganizationIds.push(orgId);
  });

  afterAll(async () => {
    await cleanupAll();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await cleanupJobs();
    adapter.summaries = [];
  });

  async function createTestJob(data: {
    externalId: string;
    title: string;
    status: JobStatus;
    lastSeenAt: Date | null;
  }) {
    const job = await prisma.job.create({
      data: {
        externalId: data.externalId,
        source: JobSource.MICRO1,
        title: data.title,
        organization: { connect: { id: orgId } },
        status: data.status,
        lastSeenAt: data.lastSeenAt,
      },
    });
    createdJobIds.push(job.id);
    return job;
  }

  async function getJobStatus(id: string) {
    const job = await prisma.job.findUnique({
      where: { id },
      select: { status: true, lastSeenAt: true },
    });
    return job;
  }

  it("closes a stale Micro1 job that was seen before syncStart", async () => {
    const job = await createTestJob({
      externalId: `test-stale-active-${Date.now()}`,
      title: "Stale Micro1 Job",
      status: JobStatus.ACTIVE,
      lastSeenAt: STALE_DATE,
    });

    adapter.summaries = [CURRENT_SUMMARY];
    await service.sync();

    const updated = await getJobStatus(job.id);
    expect(updated?.status).toBe(JobStatus.CLOSED);
  });

  it("leaves a re-seen job not-closed (lastSeenAt refreshed by upsert)", async () => {
    const externalId = `test-current-${Date.now()}`;
    const job = await createTestJob({
      externalId,
      title: "Current Micro1 Job",
      status: JobStatus.ACTIVE,
      lastSeenAt: STALE_DATE,
    });

    // Adapter sees this job → upsert refreshes lastSeenAt to syncStart
    adapter.summaries = [{ applyUrl: externalId, title: "Current Micro1 Job", companyName: "Test Co" }];
    await service.sync();

    const updated = await getJobStatus(job.id);
    expect(updated?.status).not.toBe(JobStatus.CLOSED);
    expect(updated?.lastSeenAt).not.toBeNull();
    // lastSeenAt should have been refreshed to a time >= stale date
    expect(updated!.lastSeenAt!.getTime()).toBeGreaterThan(STALE_DATE.getTime());
  });

  it("regression: floorToSeconds prevents current-sync jobs from being closed", async () => {
    // syncStart has sub-second ms; lastSeenAt is set to syncStart during upsert.
    // floorToSeconds ensures cutoff never exceeds lastSeenAt for current-sync jobs.
    const externalId = `test-regression-${Date.now()}`;
    const job = await createTestJob({
      externalId,
      title: "Regression ms precision job",
      status: JobStatus.ACTIVE,
      lastSeenAt: STALE_DATE,
    });

    adapter.summaries = [{ applyUrl: externalId, title: "Regression ms precision job", companyName: "Test Co" }];
    await service.sync();

    const updated = await getJobStatus(job.id);
    expect(updated?.status).not.toBe(JobStatus.CLOSED);
  });

  it("does NOT close a job with lastSeenAt IS NULL (legacy import)", async () => {
    const job = await createTestJob({
      externalId: `test-null-seen-${Date.now()}`,
      title: "Null LastSeenAt Job",
      status: JobStatus.ACTIVE,
      lastSeenAt: null,
    });

    adapter.summaries = [CURRENT_SUMMARY];
    await service.sync();

    const updated = await getJobStatus(job.id);
    expect(updated?.status).toBe(JobStatus.ACTIVE);
    expect(updated?.lastSeenAt).toBeNull();
  });

  it("leaves an already-CLOSED stale job as CLOSED (idempotent)", async () => {
    const job = await createTestJob({
      externalId: `test-already-closed-${Date.now()}`,
      title: "Already Closed Job",
      status: JobStatus.CLOSED,
      lastSeenAt: STALE_DATE,
    });

    adapter.summaries = [CURRENT_SUMMARY];
    await service.sync();

    const updated = await getJobStatus(job.id);
    expect(updated?.status).toBe(JobStatus.CLOSED);
  });

  it("does NOT affect jobs from another source (e.g. GREENHOUSE)", async () => {
    const job = await prisma.job.create({
      data: {
        externalId: `test-other-source-${Date.now()}`,
        source: JobSource.GREENHOUSE,
        title: "Other Source Job",
        organization: { connect: { id: orgId } },
        status: JobStatus.ACTIVE,
        lastSeenAt: STALE_DATE,
      },
    });
    createdJobIds.push(job.id);

    adapter.summaries = [CURRENT_SUMMARY];
    await service.sync();

    const updated = await getJobStatus(job.id);
    expect(updated?.status).toBe(JobStatus.ACTIVE);
    expect(updated?.status).not.toBe(JobStatus.CLOSED);
  });

  it("marks stale ON_HOLD job as CLOSED but leaves ARCHIVED untouched", async () => {
    const onHoldStale = await createTestJob({
      externalId: `test-onhold-stale-${Date.now()}`,
      title: "On Hold Stale Job",
      status: JobStatus.ON_HOLD,
      lastSeenAt: STALE_DATE,
    });

    const archivedStale = await createTestJob({
      externalId: `test-archived-stale-${Date.now()}`,
      title: "Archived Stale Job",
      status: JobStatus.ARCHIVED,
      lastSeenAt: STALE_DATE,
    });

    adapter.summaries = [CURRENT_SUMMARY];
    await service.sync();

    const updatedOnHold = await getJobStatus(onHoldStale.id);
    expect(updatedOnHold?.status).toBe(JobStatus.CLOSED);

    const updatedArchived = await getJobStatus(archivedStale.id);
    expect(updatedArchived?.status).toBe(JobStatus.ARCHIVED);
  });

  it("does NOT close stale jobs and does NOT call stale detection when source returns 0 jobs", async () => {
    const job = await createTestJob({
      externalId: `test-zero-jobs-guard-${Date.now()}`,
      title: "Stale Job Should Not Close",
      status: JobStatus.ACTIVE,
      lastSeenAt: STALE_DATE,
    });

    // adapter.summaries stays empty — source returns 0 jobs
    const result = await service.sync();

    // SourceSync still recorded
    expect(result.totalSeen).toBe(0);
    expect(result.totalStale).toBe(0);
    expect(result.staleJobs).toEqual([]);

    // Job is still ACTIVE — not closed
    const updated = await getJobStatus(job.id);
    expect(updated?.status).toBe(JobStatus.ACTIVE);
  });
});
