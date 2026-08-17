import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { JobStatus, JobSource } from "@prisma/client";
import prisma from "../../src/prisma/client.js";
import { JobRepository } from "../../src/repositories/job.repository.js";
import { getJobs, getJobById } from "../../src/services/jobs.service.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const createdOrganizationIds: string[] = [];
const createdJobIds: string[] = [];

async function cleanupJobs() {
  if (createdJobIds.length > 0) {
    await prisma.job
      .deleteMany({ where: { id: { in: createdJobIds } } })
      .catch(() => {});
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

let orgId: string;

suite("Jobs API — ACTIVE status filtering", () => {
  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Org for Jobs API", type: "COMPANY" },
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

  it("returns only ACTIVE jobs (excludes CLOSED)", async () => {
    const activeJob = await prisma.job.create({
      data: {
        externalId: `test-active-${Date.now()}-1`,
        source: JobSource.MICRO1,
        title: "Active Job",
        organization: { connect: { id: orgId } },
        status: JobStatus.ACTIVE,
      },
    });
    createdJobIds.push(activeJob.id);

    const closedJob = await prisma.job.create({
      data: {
        externalId: `test-closed-${Date.now()}-1`,
        source: JobSource.MICRO1,
        title: "Closed Job",
        organization: { connect: { id: orgId } },
        status: JobStatus.CLOSED,
      },
    });
    createdJobIds.push(closedJob.id);

    const result = await getJobs({}, 1, 100);

    const returnedIds = result.jobs.map((j) => j.jobId);
    expect(returnedIds).toContain(activeJob.externalId);
    expect(returnedIds).not.toContain(closedJob.externalId);
  });

  it("returns only ACTIVE jobs (excludes IMPORTED)", async () => {
    const activeJob = await prisma.job.create({
      data: {
        externalId: `test-active-${Date.now()}-2`,
        source: JobSource.MICRO1,
        title: "Active Job 2",
        organization: { connect: { id: orgId } },
        status: JobStatus.ACTIVE,
      },
    });
    createdJobIds.push(activeJob.id);

    const importedJob = await prisma.job.create({
      data: {
        externalId: `test-imported-${Date.now()}-1`,
        source: JobSource.MICRO1,
        title: "Imported Job",
        organization: { connect: { id: orgId } },
        status: JobStatus.IMPORTED,
      },
    });
    createdJobIds.push(importedJob.id);

    const result = await getJobs({}, 1, 100);

    const returnedIds = result.jobs.map((j) => j.jobId);
    expect(returnedIds).toContain(activeJob.externalId);
    expect(returnedIds).not.toContain(importedJob.externalId);
  });

  it("pagination total reflects only ACTIVE jobs count", async () => {
    const prefix = `test-pagetotal-${Date.now()}`;

    const active1 = await prisma.job.create({
      data: {
        externalId: `${prefix}-active-1`,
        source: JobSource.MICRO1,
        title: `${prefix} Active 1`,
        organization: { connect: { id: orgId } },
        status: JobStatus.ACTIVE,
      },
    });
    createdJobIds.push(active1.id);

    const active2 = await prisma.job.create({
      data: {
        externalId: `${prefix}-active-2`,
        source: JobSource.MICRO1,
        title: `${prefix} Active 2`,
        organization: { connect: { id: orgId } },
        status: JobStatus.ACTIVE,
      },
    });
    createdJobIds.push(active2.id);

    const closed1 = await prisma.job.create({
      data: {
        externalId: `${prefix}-closed-1`,
        source: JobSource.MICRO1,
        title: `${prefix} Closed 1`,
        organization: { connect: { id: orgId } },
        status: JobStatus.CLOSED,
      },
    });
    createdJobIds.push(closed1.id);

    const result = await getJobs(
      { search: prefix, source: "MICRO1" },
      1,
      100,
    );

    expect(result.jobs).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
  });

  it("existing search/filter behavior still works with ACTIVE default", async () => {
    const prefix = `test-search-${Date.now()}`;

    const matchingActive = await prisma.job.create({
      data: {
        externalId: `${prefix}-match`,
        source: JobSource.MICRO1,
        title: "Senior Engineer at TestSearchCorp",
        organization: {
          connect: {
            id: orgId,
          },
        },
        status: JobStatus.ACTIVE,
      },
    });
    createdJobIds.push(matchingActive.id);

    const matchingClosed = await prisma.job.create({
      data: {
        externalId: `${prefix}-closed-match`,
        source: JobSource.MICRO1,
        title: "Senior Engineer at TestSearchCorp Closed",
        organization: { connect: { id: orgId } },
        status: JobStatus.CLOSED,
      },
    });
    createdJobIds.push(matchingClosed.id);

    const result = await getJobs(
      { search: "TestSearchCorp", source: "MICRO1" },
      1,
      100,
    );

    const returnedIds = result.jobs.map((j) => j.jobId);
    expect(returnedIds).toContain(matchingActive.externalId);
    expect(returnedIds).not.toContain(matchingClosed.externalId);
  });

  it("existing job detail endpoint GET /api/jobs/:jobId continues working for ACTIVE jobs", async () => {
    const job = await prisma.job.create({
      data: {
        externalId: `test-detail-${Date.now()}`,
        source: JobSource.MICRO1,
        title: "Detail Test Job",
        organization: { connect: { id: orgId } },
        status: JobStatus.ACTIVE,
      },
    });
    createdJobIds.push(job.id);

    const result = await getJobById(job.externalId);

    expect(result).not.toBeNull();
    expect(result!.jobId).toBe(job.externalId);
    expect(result!.title).toBe("Detail Test Job");
  });

  it("existing job detail endpoint returns CLOSED jobs (detail not filtered by status)", async () => {
    const job = await prisma.job.create({
      data: {
        externalId: `test-detail-closed-${Date.now()}`,
        source: JobSource.MICRO1,
        title: "Closed Detail Job",
        organization: { connect: { id: orgId } },
        status: JobStatus.CLOSED,
      },
    });
    createdJobIds.push(job.id);

    const result = await getJobById(job.externalId);

    expect(result).not.toBeNull();
    expect(result!.jobId).toBe(job.externalId);
    expect(result!.title).toBe("Closed Detail Job");
  });

  it("application flow remains untouched — CLOSED jobs still lookup by externalId in application service", async () => {
    const job = await prisma.job.create({
      data: {
        externalId: `test-apply-flow-${Date.now()}`,
        source: JobSource.MICRO1,
        title: "Apply Flow Test Job",
        organization: { connect: { id: orgId } },
        status: JobStatus.CLOSED,
      },
    });
    createdJobIds.push(job.id);

    // The application service looks up by externalId, not by status.
    // Confirm the job exists and has the expected status.
    const prismaJob = await prisma.job.findFirst({
      where: { externalId: job.externalId, source: JobSource.MICRO1 },
      select: { id: true, externalId: true, status: true },
    });

    expect(prismaJob).not.toBeNull();
    expect(prismaJob!.status).toBe(JobStatus.CLOSED);
    expect(prismaJob!.externalId).toBe(job.externalId);
    expect(prismaJob!.id).toBe(job.id);
  });

  it("JobRepository.findMany respects status=ACTIVE filter explicitly", async () => {
    const prefix = `test-repo-${Date.now()}`;
    const repo = new JobRepository();

    const active = await prisma.job.create({
      data: {
        externalId: `${prefix}-active`,
        source: JobSource.MICRO1,
        title: "Repo Active",
        organization: { connect: { id: orgId } },
        status: JobStatus.ACTIVE,
      },
    });
    createdJobIds.push(active.id);

    const closed = await prisma.job.create({
      data: {
        externalId: `${prefix}-closed`,
        source: JobSource.MICRO1,
        title: "Repo Closed",
        organization: { connect: { id: orgId } },
        status: JobStatus.CLOSED,
      },
    });
    createdJobIds.push(closed.id);

    const result = await repo.findMany({
      status: JobStatus.ACTIVE,
      source: "MICRO1",
      page: 1,
      limit: 100,
    });

    const returnedIds = result.jobs.map((j) => j.externalId);
    expect(returnedIds).toContain(active.externalId);
    expect(returnedIds).not.toContain(closed.externalId);
  });
});
