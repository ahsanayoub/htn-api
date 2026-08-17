import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { JobStatus, JobSource } from "@prisma/client";
import { ApplicationService } from "../../src/services/applications.service.js";
import { AppError } from "../../src/errors/app-error.js";
import prisma from "../../src/prisma/client.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Skip the entire suite when no database is configured (e.g. CI without a DB).
const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

let realExternalJobId: string | null = null;
let realInternalJobId: string | null = null;
let testOrgId: string | null = null;
let testJobId: string | null = null;

const createdApplicationIds: string[] = [];
const createdCandidateIds: string[] = [];

suite("ApplicationService integration — real PostgreSQL job UUID", () => {
  const service = new ApplicationService();

  beforeAll(async () => {
    // Seed a real job UUID exactly the way GET /api/jobs/:jobId exposes it
    // (i.e. the job's externalId, which is a UUID for Micro1-sourced jobs).
    // Try to find an existing ACTIVE job; if none exist, create a test one.
    const jobs = await prisma.job.findMany({
      where: { externalId: { not: null }, status: JobStatus.ACTIVE },
      select: { id: true, externalId: true, status: true },
      take: 250,
    });

    const sample = jobs.find(
      (j) => j.externalId && UUID_REGEX.test(j.externalId),
    );

    if (sample) {
      realExternalJobId = sample.externalId!;
      realInternalJobId = sample.id;
    } else {
      // No ACTIVE jobs in DB — create a test ACTIVE job with a UUID externalId.
      const org = await prisma.organization.create({
        data: { name: "Test Org for App Integration", type: "COMPANY" },
      });
      testOrgId = org.id;

      const job = await prisma.job.create({
        data: {
          externalId: "11111111-2222-4333-8444-555555555555",
          source: JobSource.MICRO1,
          title: "Test Active Job for App Integration",
          organization: { connect: { id: org.id } },
          status: JobStatus.ACTIVE,
        },
      });
      testJobId = job.id;
      realExternalJobId = job.externalId;
      realInternalJobId = job.id;
    }

    expect(realExternalJobId).toMatch(UUID_REGEX);
  });

  afterAll(async () => {
    await cleanupAll();
    if (testJobId) {
      await prisma.job.delete({ where: { id: testJobId } }).catch(() => {});
    }
    if (testOrgId) {
      await prisma.organization
        .delete({ where: { id: testOrgId } })
        .catch(() => {});
    }
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await cleanupAll();
  });

  async function cleanupAll() {
    if (createdApplicationIds.length > 0) {
      await prisma.application
        .deleteMany({ where: { id: { in: createdApplicationIds } } })
        .catch(() => {});
      createdApplicationIds.length = 0;
    }
    if (createdCandidateIds.length > 0) {
      await prisma.candidate
        .deleteMany({ where: { id: { in: createdCandidateIds } } })
        .catch(() => {});
      createdCandidateIds.length = 0;
    }
  }

  it("creates an application using a real PostgreSQL job external UUID (minimal payload)", async () => {
    if (!realExternalJobId) throw new Error("realExternalJobId not seeded");

    const result = await service.createApplication({
      jobId: realExternalJobId,
      firstName: "Integration",
      lastName: "Tester",
      email: `integration-minimal-${Date.now()}@example.com`,
    });

    createdApplicationIds.push(result.id);
    createdCandidateIds.push(result.candidateId);

    expect(result.id).toBeTruthy();
    expect(result.candidateId).toBeTruthy();
    // The application must reference the job by its internal DB id, not the external UUID.
    expect(result.job.id).toBe(realInternalJobId);
    expect(result.status).toBe("APPLIED");
    expect(result.source).toBe("CAREERS_SITE");
  });

  it("creates an application using a real PostgreSQL job external UUID (full payload)", async () => {
    if (!realExternalJobId) throw new Error("realExternalJobId not seeded");

    const email = `integration-full-${Date.now()}@example.com`;

    const result = await service.createApplication({
      jobId: realExternalJobId,
      firstName: "Full",
      lastName: "Payload",
      email,
      phone: "555-1234",
      location: "Austin",
      linkedinUrl: "https://linkedin.com/in/integration",
      currentCompany: "Acme Integration Corp",
      currentTitle: "Engineer",
      yearsExperience: 4,
      desiredSalary: 95000,
      noticePeriod: 2,
      coverLetter: "Dear Hiring Manager, I am very interested.",
      additionalNotes: "Available next week",
      certifications: "AWS Certified",
      certificationAcknowledged: true,
    });

    createdApplicationIds.push(result.id);
    createdCandidateIds.push(result.candidateId);

    expect(result.id).toBeTruthy();
    expect(result.candidate.email).toBe(email);
    expect(result.job.id).toBe(realInternalJobId);
    expect(result.metadata).toEqual({
      certifications: "AWS Certified",
      certificationAcknowledged: true,
    });
  });

  it("rejects a malformed/non-UUID jobId as VALIDATION_ERROR (400), never 500", async () => {
    const error = await service
      .createApplication({
        jobId: "not-a-uuid",
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
      })
      .catch((e: unknown) => e) as AppError;

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.statusCode).toBe(400);
  });

  it("returns JOB_NOT_FOUND (404) for a valid UUID that no job has", async () => {
    const unusedUuid = "00000000-0000-4000-8000-000000000000";

    const error = await service
      .createApplication({
        jobId: unusedUuid,
        firstName: "John",
        lastName: "Doe",
        email: `notfound-${Date.now()}@example.com`,
      })
      .catch((e: unknown) => e) as AppError;

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("JOB_NOT_FOUND");
    expect(error.statusCode).toBe(404);
  });
});
