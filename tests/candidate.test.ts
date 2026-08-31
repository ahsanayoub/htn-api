import { describe, it, expect, vi, beforeEach } from "vitest";
import { CandidateService } from "../src/services/candidate.service.js";
import { AppError } from "../src/errors/app-error.js";

const VALID_RESUME = {
  uploadId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  storageKey: "resumes/6ba7b810-9dad-11d1-80b4-00c04fd430c8.pdf",
  fileName: "john-doe-resume.pdf",
  mimeType: "application/pdf",
  size: 123456,
};

const { mockTx, mockTransaction, mockVerifyResume } = vi.hoisted(
  () => {
    const mockVerifyResume = vi.fn().mockResolvedValue({
      size: 123456,
      mimeType: "application/pdf",
      etag: "etag-1",
    });
    const mockTx = {
      candidate: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      document: { create: vi.fn() },
      organization: { findFirst: vi.fn(), create: vi.fn() },
    };
    const mockTransaction = vi.fn(async (fn: any) => fn(mockTx));
    return { mockTx, mockTransaction, mockVerifyResume };
  },
);

vi.mock("../src/prisma/client.js", () => ({
  default: { $transaction: mockTransaction },
}));

vi.mock("../src/services/r2-storage.service.js", () => ({
  R2StorageService: class {
    verifyUploadedResume = mockVerifyResume;
  },
}));

function captureError(promise: Promise<unknown>): Promise<AppError> {
  return promise.catch((e: unknown) => e) as Promise<AppError>;
}

describe("CandidateService.joinTalentNetwork", () => {
  const service = new CandidateService();

  beforeEach(() => {
    mockTransaction.mockClear();
    mockVerifyResume.mockReset();
    mockVerifyResume.mockResolvedValue({
      size: 123456,
      mimeType: "application/pdf",
      etag: "etag-1",
    });
    mockTx.candidate.findFirst.mockReset();
    mockTx.candidate.create.mockReset();
    mockTx.candidate.update.mockReset();
    mockTx.document.create.mockReset();
    mockTx.organization.findFirst.mockReset();
    mockTx.organization.create.mockReset();
  });

  describe("validation", () => {
    it("should reject when body is null", async () => {
      const error = await captureError(service.joinTalentNetwork(null));

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("should reject when required fields are missing", async () => {
      const error = await captureError(
        service.joinTalentNetwork({ firstName: "John" }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toContain("Missing required fields");
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("should reject when contactConsent is missing", async () => {
      const error = await captureError(
        service.joinTalentNetwork({
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          resume: VALID_RESUME,
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("should reject when contactConsent is false", async () => {
      const error = await captureError(
        service.joinTalentNetwork({
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          resume: VALID_RESUME,
          contactConsent: false,
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
      expect(error.message).toContain("contactConsent");
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("should reject when email is invalid", async () => {
      const error = await captureError(
        service.joinTalentNetwork({
          firstName: "John",
          lastName: "Doe",
          email: "not-an-email",
          resume: VALID_RESUME,
          contactConsent: true,
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toContain("Invalid email address");
    });

    it("should reject when resume.uploadId is not a UUID", async () => {
      const error = await captureError(
        service.joinTalentNetwork({
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          resume: { ...VALID_RESUME, uploadId: "not-a-uuid" },
          contactConsent: true,
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toContain("Invalid resume uploadId");
    });

    it("should reject when resume fields are incomplete", async () => {
      const error = await captureError(
        service.joinTalentNetwork({
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          resume: { ...VALID_RESUME, fileName: "" },
          contactConsent: true,
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toContain(
        "resume.uploadId, storageKey, fileName, mimeType, and size are required",
      );
    });
  });

  describe("happy path — new candidate", () => {
    it("should create a new candidate with consent and resume document", async () => {
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockTx.organization.findFirst.mockResolvedValue(null);
      mockTx.organization.create.mockResolvedValue({ id: "org-1" });
      mockTx.candidate.create.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        metadata: null,
      });
      mockTx.candidate.update.mockResolvedValue({
        id: "candidate-1",
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        metadata: { certifications: "AWS Certified" },
        inTalentPool: true,
        contactConsent: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockTx.document.create.mockResolvedValue({ id: "doc-1" });

      const result = await service.joinTalentNetwork({
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "555-1234",
        location: "Austin",
        currentCompany: "Example Corp",
        currentTitle: "Engineer",
        yearsExperience: 5,
        linkedinUrl: "https://linkedin.com/in/example",
        certifications: "AWS Certified",
        additionalNotes: "Looking for remote work",
        resume: VALID_RESUME,
        contactConsent: true,
      });

      expect(result.id).toBe("candidate-1");
      expect(result.firstName).toBe("John");
      expect(result.lastName).toBe("Doe");
      expect(result.email).toBe("john@example.com");
      expect(result.inTalentPool).toBe(true);
      expect(result.contactConsent).toBe(true);
      expect(mockTx.candidate.create).toHaveBeenCalledOnce();
      expect(mockTx.candidate.update).toHaveBeenCalledOnce();
      expect(mockTx.document.create).toHaveBeenCalledOnce();
      expect(mockVerifyResume).toHaveBeenCalledWith(
        VALID_RESUME.uploadId,
        VALID_RESUME.storageKey,
        VALID_RESUME.mimeType,
        VALID_RESUME.size,
      );
    });
  });

  describe("happy path — existing candidate", () => {
    it("should update existing candidate instead of creating a duplicate", async () => {
      mockTx.candidate.findFirst.mockResolvedValue({
        id: "candidate-existing",
        email: "john@example.com",
        firstName: "Johnny",
        lastName: "Doe",
        metadata: null,
      });
      mockTx.candidate.update.mockResolvedValue({
        id: "candidate-existing",
        email: "john@example.com",
        firstName: "Johnny",
        lastName: "Doe",
        metadata: null,
        inTalentPool: true,
        contactConsent: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockTx.document.create.mockResolvedValue({ id: "doc-1" });

      const result = await service.joinTalentNetwork({
        firstName: "Johnny",
        lastName: "Doe",
        email: "john@example.com",
        resume: VALID_RESUME,
        contactConsent: true,
      });

      expect(mockTx.candidate.findFirst).toHaveBeenCalledWith({
        where: { email: "john@example.com" },
      });
      expect(mockTx.candidate.create).not.toHaveBeenCalled();
      expect(mockTx.candidate.update).toHaveBeenCalledTimes(2);
      expect(result.inTalentPool).toBe(true);
      expect(result.contactConsent).toBe(true);
    });
  });

  describe("resume verification", () => {
    it("should return VALIDATION_ERROR when resume object is not found in storage", async () => {
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockVerifyResume.mockRejectedValue(
        new AppError(
          "VALIDATION_ERROR",
          "Resume upload was not found in storage. Upload the resume before submitting the application.",
          400,
        ),
      );

      const error = await captureError(
        service.joinTalentNetwork({
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          resume: VALID_RESUME,
          contactConsent: true,
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
      expect(mockTx.candidate.create).not.toHaveBeenCalled();
      expect(mockTx.candidate.update).not.toHaveBeenCalled();
      expect(mockTx.document.create).not.toHaveBeenCalled();
    });

    it("should return VALIDATION_ERROR when storage key is invalid", async () => {
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockVerifyResume.mockRejectedValue(
        new AppError("VALIDATION_ERROR", "Invalid resume storage key.", 400),
      );

      const error = await captureError(
        service.joinTalentNetwork({
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          resume: VALID_RESUME,
          contactConsent: true,
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
      expect(mockTx.candidate.create).not.toHaveBeenCalled();
      expect(mockTx.document.create).not.toHaveBeenCalled();
    });

    it("should return VALIDATION_ERROR when stored size does not match", async () => {
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockVerifyResume.mockRejectedValue(
        new AppError(
          "VALIDATION_ERROR",
          "Resume size does not match the uploaded file.",
          400,
        ),
      );

      const error = await captureError(
        service.joinTalentNetwork({
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          resume: VALID_RESUME,
          contactConsent: true,
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
      expect(mockTx.candidate.create).not.toHaveBeenCalled();
    });

    it("should return VALIDATION_ERROR when MIME type does not match", async () => {
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockVerifyResume.mockRejectedValue(
        new AppError(
          "VALIDATION_ERROR",
          "Resume content type does not match the uploaded file.",
          400,
        ),
      );

      const error = await captureError(
        service.joinTalentNetwork({
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          resume: VALID_RESUME,
          contactConsent: true,
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
      expect(mockTx.candidate.create).not.toHaveBeenCalled();
    });

    it("should return INTERNAL_ERROR for unexpected infrastructure errors", async () => {
      mockTx.candidate.findFirst.mockResolvedValue(null);
      mockVerifyResume.mockRejectedValue(new Error("R2 network timeout"));

      const error = await captureError(
        service.joinTalentNetwork({
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          resume: VALID_RESUME,
          contactConsent: true,
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("INTERNAL_ERROR");
      expect(error.message).toBe("Internal server error");
      expect(error.statusCode).toBe(500);
      expect(mockTx.candidate.create).not.toHaveBeenCalled();
      expect(mockTx.document.create).not.toHaveBeenCalled();
    });
  });

  describe("internal error handling", () => {
    it("should convert unexpected errors to INTERNAL_ERROR without exposing details", async () => {
      mockTx.candidate.findFirst.mockRejectedValue(
        new Error("DB connection lost"),
      );

      const error = await captureError(
        service.joinTalentNetwork({
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          resume: VALID_RESUME,
          contactConsent: true,
        }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("INTERNAL_ERROR");
      expect(error.message).toBe("Internal server error");
      expect(error.statusCode).toBe(500);
    });
  });
});
