import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Prisma, JobStatus, JobSource } from "@prisma/client";
import prisma from "../../src/prisma/client.js";
import { JobRepository } from "../../src/repositories/job.repository.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const SYNC_START = new Date("2026-08-15T00:00:00.000Z");
const STALE_DATE = new Date("2026-08-10T00:00:00.000Z");
const CURRENT_DATE = new Date("2026-08-15T12:00:00.000Z");

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

suite("JobRepository.markStaleJobsAsClosed integration", () => {
  const repo = new JobRepository();

  let orgId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: {
        name: "Test Org for Stale Jobs",
        type: "COMPANY",
      },
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
  });

  it("closes a stale Micro1 job that was seen before syncStart (lastSeenAt NOT NULL)", async () => {
    const job = await prisma.job.create({
      data: {
        externalId: `test-stale-active-${Date.now()}`,
        source: JobSource.MICRO1,
        title: "Stale Micro1 Job",
        organization: { connect: { id: orgId } },
        status: JobStatus.ACTIVE,
        lastSeenAt: STALE_DATE,
      },
    });
    createdJobIds.push(job.id);

    const closed = await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);
    expect(closed).toBeGreaterThanOrEqual(1);

    const updated = await prisma.job.findUnique({
      where: { id: job.id },
      select: { status: true },
    });
    expect(updated?.status).toBe(JobStatus.CLOSED);
  });

  it("leaves a currently-seen job ACTIVE (lastSeenAt >= syncStart)", async () => {
    const job = await prisma.job.create({
      data: {
        externalId: `test-current-${Date.now()}`,
        source: JobSource.MICRO1,
        title: "Current Micro1 Job",
        organization: { connect: { id: orgId } },
        status: JobStatus.ACTIVE,
        lastSeenAt: CURRENT_DATE,
      },
    });
    createdJobIds.push(job.id);

    const closed = await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);

    const updated = await prisma.job.findUnique({
      where: { id: job.id },
      select: { status: true },
    });
    expect(updated?.status).toBe(JobStatus.ACTIVE);
  });

  // Regression for the Step 6B precision bug: syncStart carries sub-second
  // milliseconds (20:27:47.797) while the database stored lastSeenAt with the
  // milliseconds truncated to 20:27:47.000. A naive `lastSeenAt < syncStart`
  // evaluates to TRUE and wrongly closes every job seen during the current
  // sync. The fix floors the cutoff to whole seconds so the job stays ACTIVE.
  it("regression: job seen this sync stays ACTIVE when syncStart has ms but lastSeenAt is seconds-truncated", async () => {
    const syncStart = new Date("2026-08-14T20:27:47.797Z");
    const secondsTruncatedLastSeen = new Date("2026-08-14T20:27:47.000Z");

    const job = await prisma.job.create({
      data: {
        externalId: `test-regression-ms-${Date.now()}`,
        source: JobSource.MICRO1,
        title: "Regression ms precision job",
        organization: { connect: { id: orgId } },
        status: JobStatus.ACTIVE,
        lastSeenAt: secondsTruncatedLastSeen,
      },
    });
    createdJobIds.push(job.id);

    const closed = await repo.markStaleJobsAsClosed(JobSource.MICRO1, syncStart);

    const updated = await prisma.job.findUnique({
      where: { id: job.id },
      select: { status: true },
    });
    expect(updated?.status).toBe(JobStatus.ACTIVE);
  });

  it("does NOT close a job with lastSeenAt IS NULL (legacy import)", async () => {
    const job = await prisma.job.create({
      data: {
        externalId: `test-null-seen-${Date.now()}`,
        source: JobSource.MICRO1,
        title: "Null LastSeenAt Job",
        organization: { connect: { id: orgId } },
        status: JobStatus.ACTIVE,
        lastSeenAt: null,
      },
    });
    createdJobIds.push(job.id);

    await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);

    const updated = await prisma.job.findUnique({
      where: { id: job.id },
      select: { status: true, lastSeenAt: true },
    });
    expect(updated?.status).toBe(JobStatus.ACTIVE);
    expect(updated?.lastSeenAt).toBeNull();
  });

  it("leaves an already-CLOSED stale job as CLOSED (idempotent)", async () => {
    const job = await prisma.job.create({
      data: {
        externalId: `test-already-closed-${Date.now()}`,
        source: JobSource.MICRO1,
        title: "Already Closed Job",
        organization: { connect: { id: orgId } },
        status: JobStatus.CLOSED,
        lastSeenAt: STALE_DATE,
      },
    });
    createdJobIds.push(job.id);

    const closed = await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);
    // The already-closed job should NOT be counted in the updateMany result
    // (it's excluded by the NOT IN [CLOSED, ARCHIVED] clause)
    expect(closed).toBe(0);

    const updated = await prisma.job.findUnique({
      where: { id: job.id },
      select: { status: true },
    });
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

    await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);

    const updated = await prisma.job.findUnique({
      where: { id: job.id },
      select: { status: true, source: true },
    });
    expect(updated?.status).toBe(JobStatus.ACTIVE);
    expect(updated?.source).toBe(JobSource.GREENHOUSE);
  });

  it("marks stale ON_HOLD job as CLOSED but leaves ARCHIVED untouched", async () => {
    const onHoldStale = await prisma.job.create({
      data: {
        externalId: `test-onhold-stale-${Date.now()}`,
        source: JobSource.MICRO1,
        title: "On Hold Stale Job",
        organization: { connect: { id: orgId } },
        status: JobStatus.ON_HOLD,
        lastSeenAt: STALE_DATE,
      },
    });
    createdJobIds.push(onHoldStale.id);

    const archivedStale = await prisma.job.create({
      data: {
        externalId: `test-archived-stale-${Date.now()}`,
        source: JobSource.MICRO1,
        title: "Archived Stale Job",
        organization: { connect: { id: orgId } },
        status: JobStatus.ARCHIVED,
        lastSeenAt: STALE_DATE,
      },
    });
    createdJobIds.push(archivedStale.id);

    await repo.markStaleJobsAsClosed(JobSource.MICRO1, SYNC_START);

    const updatedOnHold = await prisma.job.findUnique({
      where: { id: onHoldStale.id },
      select: { status: true },
    });
    expect(updatedOnHold?.status).toBe(JobStatus.CLOSED);

    const updatedArchived = await prisma.job.findUnique({
      where: { id: archivedStale.id },
      select: { status: true },
    });
    expect(updatedArchived?.status).toBe(JobStatus.ARCHIVED);
  });
});
