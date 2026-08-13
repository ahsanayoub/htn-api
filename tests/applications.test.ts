import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { ApplicationService } from "../src/services/applications.service.js";
import { AppError } from "../src/errors/app-error.js";

const { mockTx, mockTransaction } = vi.hoisted(() => {
  const mockTx = {
    job: { findFirst: vi.fn() },
    candidate: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    application: { findFirst: vi.fn(), create: vi.fn() },
    organization: { findFirst: vi.fn(), create: vi.fn() },
  };
  const mockTransaction = vi.fn(async (fn: any) => fn(mockTx));
  return { mockTx, mockTransaction };
});

vi.mock("../src/prisma/client.js", () => ({
  default: { $transaction: mockTransaction },
}));

// What the frontend sends (the externalId exposed by GET /api/jobs/:jobId)
const EXTERNAL_JOB_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
// The internal primary key of the Job row (what Application.jobId FK references)
const INTERNAL_JOB_ID = "123e4567-e89b-12d3-a456-426614174000";
const VALID_JOB = {
  id: INTERNAL_JOB_ID,
  title: "Senior Engineer",
  status: "ACTIVE",
};

function captureError(promise: Promise<unknown>): Promise<AppError> {
  return promise.catch((e: unknown) => e) as Promise<AppError>;
}

describe("ApplicationService.createApplication", () => {
  const service = new ApplicationService();

  beforeEach(() => {
    mockTransaction.mockClear();
    mockTx.job.findFirst.mockReset();
    mockTx.candidate.findFirst.mockReset();
    mockTx.candidate.create.mockReset();
    mockTx.candidate.update.mockReset();
    mockTx.application.findFirst.mockReset();
    mockTx.application.create.mockReset();
    mockTx.organization.findFirst.mockReset();
    mockTx.organization.create.mockReset();
  });

  describe("regression: resolves job by externalId (matches GET /api/jobs/:jobId)", () => {
    it("looks the job up by externalId, not the internal id", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: {
          id: "candidate-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
      });

      expect(mockTx.job.findFirst).toHaveBeenCalledOnce();
      expect(mockTx.job.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { externalId: EXTERNAL_JOB_ID },
          select: { id: true, title: true, status: true },
        }),
      );
    });

    it("stores the resolved internal job.id (not the externalId) on the application", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: {
          id: "candidate-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
      });

      const createCall = mockTx.application.create.mock.calls[0][0];
      expect(createCall.data.jobId).toBe(INTERNAL_JOB_ID);
    });
  });

  describe("happy path", () => {
    it("should create a new candidate and application when candidate does not exist", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: {
          id: "candidate-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      const result = await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
      });

      expect(result.id).toBe("app-1");
      expect(result.candidateId).toBe("candidate-1");
      expect(mockTx.candidate.create).toHaveBeenCalledOnce();
      expect(mockTx.candidate.update).not.toHaveBeenCalled();
    });

    it("should update existing candidate and create a new application when candidate exists", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue({
        id: "candidate-existing",
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
      });
      mockTx.application.findFirst.mockResolvedValue(null);
      mockTx.candidate.update.mockResolvedValue({
        id: "candidate-existing",
        email: "john@example.com",
        firstName: "Johnny",
        lastName: "Doe",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-2",
        candidateId: "candidate-existing",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: {
          id: "candidate-existing",
          firstName: "Johnny",
          lastName: "Doe",
          email: "john@example.com",
        },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      const result = await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "Johnny",
        lastName: "Doe",
        email: "john@example.com",
        phone: "555-1234",
      });

      expect(result.id).toBe("app-2");
      expect(mockTx.candidate.update).toHaveBeenCalledOnce();
      expect(mockTx.candidate.create).not.toHaveBeenCalled();
    });
  });

  describe("duplicate application", () => {
    it("should return ALREADY_APPLIED when candidate already applied to the job", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.findFirst.mockResolvedValue({ id: "existing-app" });

      const error = await captureError(
        service.createApplication({
          jobId: EXTERNAL_JOB_ID,
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("ALREADY_APPLIED");
      expect(error.message).toBe("You have already applied to this role.");
      expect(mockTx.candidate.update).not.toHaveBeenCalled();
      expect(mockTx.candidate.create).not.toHaveBeenCalled();
      expect(mockTx.application.create).not.toHaveBeenCalled();
    });

    it("should return ALREADY_APPLIED on P2002 unique constraint violation (race condition)", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.findFirst.mockResolvedValue(null);
      mockTx.candidate.update.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });

      const prismaError = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        "P2002",
        { target: ["candidateId", "jobId"] },
      );
      prismaError.code = "P2002";
      mockTx.application.create.mockRejectedValue(prismaError);

      const error = await captureError(
        service.createApplication({
          jobId: EXTERNAL_JOB_ID,
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("ALREADY_APPLIED");
    });
  });

  describe("job validation", () => {
    it("should return JOB_NOT_FOUND when job does not exist", async () => {
      mockTx.job.findFirst.mockResolvedValue(null);

      const error = await captureError(
        service.createApplication({
          jobId: EXTERNAL_JOB_ID,
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("JOB_NOT_FOUND");
    });

    it("should reject applications to a CLOSED job", async () => {
      mockTx.job.findFirst.mockResolvedValue({
        id: INTERNAL_JOB_ID,
        title: "Senior Engineer",
        status: "CLOSED",
      });

      const error = await captureError(
        service.createApplication({
          jobId: EXTERNAL_JOB_ID,
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("JOB_CLOSED");
      expect(mockTx.candidate.create).not.toHaveBeenCalled();
    });

    it("should reject applications to an ARCHIVED job", async () => {
      mockTx.job.findFirst.mockResolvedValue({
        id: INTERNAL_JOB_ID,
        title: "Senior Engineer",
        status: "ARCHIVED",
      });

      const error = await captureError(
        service.createApplication({
          jobId: EXTERNAL_JOB_ID,
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("JOB_CLOSED");
    });

    it("should allow applications to a job that is not CLOSED or ARCHIVED", async () => {
      mockTx.job.findFirst.mockResolvedValue({
        id: INTERNAL_JOB_ID,
        title: "Engineer",
        status: "ACTIVE",
      });
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: { id: "candidate-1", firstName: "John", lastName: "Doe", email: "john@example.com" },
        job: { id: INTERNAL_JOB_ID, title: "Engineer", status: "ACTIVE" },
      });

      const result = await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
      });

      expect(result.id).toBe("app-1");
    });
  });

  describe("jobId format validation", () => {
    it("should reject a malformed/non-UUID jobId as VALIDATION_ERROR (400) instead of 500", async () => {
      const error = await captureError(
        service.createApplication({
          jobId: "not-a-uuid",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
      expect(error.message).toContain("Invalid jobId");
      // Must not reach the database
      expect(mockTx.job.findFirst).not.toHaveBeenCalled();
      expect(mockTx.application.create).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("should reject when required fields are missing", async () => {
      const error = await captureError(
        service.createApplication({ firstName: "John" }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toContain("Missing required fields");
    });

    it("should reject when body is not an object", async () => {
      const error = await captureError(service.createApplication(null));

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
    });

    it("should reject when email is invalid", async () => {
      const error = await captureError(
        service.createApplication({
          jobId: EXTERNAL_JOB_ID,
          firstName: "John",
          lastName: "Doe",
          email: "not-an-email",
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toContain("Invalid email address");
    });
  });

  describe("email normalization", () => {
    it("should normalize email by trimming and lowercasing", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: { id: "candidate-1", firstName: "John", lastName: "Doe", email: "john@example.com" },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "  JOHN@EXAMPLE.COM  ",
      });

      expect(mockTx.candidate.findFirst).toHaveBeenCalledWith({
        where: { email: "john@example.com" },
      });
      expect(mockTx.candidate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: "john@example.com",
          }),
        }),
      );
    });
  });

  describe("empty optional fields", () => {
    it("should not store empty strings for optional fields on candidate create", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: { id: "candidate-1", firstName: "John", lastName: "Doe", email: "john@example.com" },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "",
        linkedinUrl: "",
        portfolioUrl: "",
        githubUrl: "",
        currentTitle: "",
      });

      const createCall = mockTx.candidate.create.mock.calls[0][0];
      expect(createCall.data.phone).toBeUndefined();
      expect(createCall.data.linkedinUrl).toBeUndefined();
      expect(createCall.data.portfolioUrl).toBeUndefined();
      expect(createCall.data.githubUrl).toBeUndefined();
      expect(createCall.data.currentTitle).toBeUndefined();
    });
  });

  describe("candidate field preservation", () => {
    it("should not overwrite existing candidate fields with empty values", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
        phone: "555-1234",
        linkedinUrl: "https://linkedin.com/in/john",
        currentTitle: "Senior Dev",
      });
      mockTx.application.findFirst.mockResolvedValue(null);
      mockTx.candidate.update.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: { id: "candidate-1", firstName: "John", lastName: "Doe", email: "john@example.com" },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "",
        linkedinUrl: "",
        currentTitle: "",
      });

      const updateCall = mockTx.candidate.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("phone");
      expect(updateCall.data).not.toHaveProperty("linkedinUrl");
      expect(updateCall.data).not.toHaveProperty("currentTitle");
    });

    it("should overwrite existing candidate fields when new non-empty values are provided", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
        phone: "555-1234",
        linkedinUrl: "https://linkedin.com/in/old",
      });
      mockTx.application.findFirst.mockResolvedValue(null);
      mockTx.candidate.update.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: { id: "candidate-1", firstName: "John", lastName: "Doe", email: "john@example.com" },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "555-9999",
        linkedinUrl: "https://linkedin.com/in/new",
      });

      const updateCall = mockTx.candidate.update.mock.calls[0][0];
      expect(updateCall.data.phone).toBe("555-9999");
      expect(updateCall.data.linkedinUrl).toBe("https://linkedin.com/in/new");
    });
  });

  describe("client cannot set protected fields", () => {
    it("should not allow client to set application status", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: { id: "candidate-1", firstName: "John", lastName: "Doe", email: "john@example.com" },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        status: "REJECTED" as any,
        submittedAt: "2020-01-01T00:00:00Z" as any,
        candidateId: "attacker-controlled-id" as any,
      });

      const createCall = mockTx.application.create.mock.calls[0][0];
      expect(createCall.data.status).toBe("APPLIED");
      expect(createCall.data.submittedAt).toBeInstanceOf(Date);
      expect(createCall.data.candidateId).toBe("candidate-1");
      expect(createCall.data.source).toBe("CAREERS_SITE");
    });
  });

  describe("certifications stored in metadata", () => {
    it("should store certifications in application metadata", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: { certifications: "AWS Certified, Google Cloud" },
        candidate: { id: "candidate-1", firstName: "John", lastName: "Doe", email: "john@example.com" },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        certifications: "AWS Certified, Google Cloud",
      });

      const createCall = mockTx.application.create.mock.calls[0][0];
      expect(createCall.data.metadata).toEqual({
        certifications: "AWS Certified, Google Cloud",
      });
    });

    it("should set metadata to undefined when certifications are not provided", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: { id: "candidate-1", firstName: "John", lastName: "Doe", email: "john@example.com" },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
      });

      const createCall = mockTx.application.create.mock.calls[0][0];
      expect(createCall.data.metadata).toBeUndefined();
    });
  });

  describe("location handling", () => {
    it("should persist location and city on candidate create", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: {
          id: "candidate-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        location: "New York",
      });

      const createCall = mockTx.candidate.create.mock.calls[0][0];
      expect(createCall.data.location).toBe("New York");
      expect(createCall.data.city).toBe("New York");
    });

    it("should persist location and city on candidate update", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.findFirst.mockResolvedValue(null);
      mockTx.candidate.update.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: {
          id: "candidate-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        location: "San Francisco",
      });

      const updateCall = mockTx.candidate.update.mock.calls[0][0];
      expect(updateCall.data.location).toBe("San Francisco");
      expect(updateCall.data.city).toBe("San Francisco");
    });

    it("should not set location when not provided", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: {
          id: "candidate-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
      });

      const createCall = mockTx.candidate.create.mock.calls[0][0];
      expect(createCall.data.location).toBeUndefined();
      expect(createCall.data.city).toBeUndefined();
    });
  });

  describe("certificationAcknowledged handling", () => {
    it("should store certificationAcknowledged in application metadata", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: {
          id: "candidate-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        certificationAcknowledged: true,
      });

      const createCall = mockTx.application.create.mock.calls[0][0];
      expect(createCall.data.metadata).toEqual({
        certificationAcknowledged: true,
      });
    });

    it("should store both certifications and certificationAcknowledged when both provided", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: {
          id: "candidate-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        certifications: "AWS Certified",
        certificationAcknowledged: true,
      });

      const createCall = mockTx.application.create.mock.calls[0][0];
      expect(createCall.data.metadata).toEqual({
        certifications: "AWS Certified",
        certificationAcknowledged: true,
      });
    });
  });

  describe("coverLetter handling", () => {
    it("should persist coverLetter on application", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: {
          id: "candidate-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        coverLetter: "I am excited about this role...",
      });

      const createCall = mockTx.application.create.mock.calls[0][0];
      expect(createCall.data.coverLetter).toBe(
        "I am excited about this role...",
      );
    });

    it("should set coverLetter to undefined when not provided", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: {
          id: "candidate-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
      });

      const createCall = mockTx.application.create.mock.calls[0][0];
      expect(createCall.data.coverLetter).toBeUndefined();
    });
  });

  describe("minimal frontend payload", () => {
    it("should accept the minimal required-field payload (4 fields)", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: undefined,
        candidate: { id: "candidate-1", firstName: "John", lastName: "Doe", email: "john@example.com" },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      const result = await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
      });

      expect(result.id).toBe("app-1");
      const createCall = mockTx.application.create.mock.calls[0][0];
      expect(createCall.data.jobId).toBe(INTERNAL_JOB_ID);
      expect(createCall.data.status).toBe("APPLIED");
      expect(createCall.data.source).toBe("CAREERS_SITE");
      expect(createCall.data.submittedAt).toBeInstanceOf(Date);
    });
  });

  describe("full frontend payload", () => {
    it("should accept the complete frontend apply form payload", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
      });
      mockTx.application.findFirst.mockResolvedValue(null);
      mockTx.organization.findFirst.mockResolvedValue(null);
      mockTx.organization.create.mockResolvedValue({ id: "org-1" });
      mockTx.application.create.mockResolvedValue({
        id: "app-1",
        candidateId: "candidate-1",
        jobId: INTERNAL_JOB_ID,
        status: "APPLIED",
        submittedAt: new Date(),
        source: "CAREERS_SITE",
        metadata: null,
        candidate: {
          id: "candidate-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        },
        job: { id: INTERNAL_JOB_ID, title: "Senior Engineer", status: "ACTIVE" },
      });

      await service.createApplication({
        jobId: EXTERNAL_JOB_ID,
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "555-1234",
        location: "New York",
        linkedinUrl: "https://linkedin.com/in/john",
        currentCompany: "Acme Corp",
        currentTitle: "Engineer",
        yearsExperience: 5,
        desiredSalary: 80000,
        noticePeriod: 2,
        coverLetter: "Dear Hiring Manager...",
        additionalNotes: "Available for interview next week",
        certificationAcknowledged: true,
      });

      const candidateCreateCall = mockTx.candidate.create.mock.calls[0][0];
      expect(candidateCreateCall.data.location).toBe("New York");
      expect(candidateCreateCall.data.city).toBe("New York");
      expect(candidateCreateCall.data.phone).toBe("555-1234");
      expect(candidateCreateCall.data.currentTitle).toBe("Engineer");
      expect(candidateCreateCall.data.yearsExperience).toBe(5);

      const appCreateCall = mockTx.application.create.mock.calls[0][0];
      expect(appCreateCall.data.coverLetter).toBe("Dear Hiring Manager...");
      expect(appCreateCall.data.additionalNotes).toBe(
        "Available for interview next week",
      );
      expect(appCreateCall.data.salaryExpectation).toBe(80000);
      expect(appCreateCall.data.noticePeriod).toBe(2);
      expect(appCreateCall.data.jobId).toBe(INTERNAL_JOB_ID);
      expect(appCreateCall.data.metadata).toEqual({
        certificationAcknowledged: true,
      });
    });
  });

  describe("internal error handling", () => {
    it("should convert unexpected errors to INTERNAL_ERROR without exposing details", async () => {
      mockTx.job.findFirst.mockResolvedValue(VALID_JOB);
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.candidate.create.mockRejectedValue(new Error("DB connection lost"));

      const error = await captureError(
        service.createApplication({
          jobId: EXTERNAL_JOB_ID,
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("INTERNAL_ERROR");
      expect(error.message).toBe("Internal server error");
    });
  });
});
