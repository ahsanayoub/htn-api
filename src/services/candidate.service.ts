import prisma from "../prisma/client.js";
import { AppError } from "../errors/app-error.js";
import { ApplicationRepository } from "../repositories/application.repository.js";
import { R2StorageService } from "./r2-storage.service.js";

export interface TalentNetworkInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  location?: string;
  currentCompany?: string;
  currentTitle?: string;
  yearsExperience?: number;
  linkedinUrl?: string;
  portfolioUrl?: string;
  githubUrl?: string;
  certifications?: string;
  additionalNotes?: string;
  resume: {
    uploadId: string;
    storageKey: string;
    fileName: string;
    mimeType: string;
    size: number;
  };
  contactConsent: boolean;
}

export interface TalentNetworkResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  inTalentPool: boolean;
  contactConsent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
}

function sanitizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

export class CandidateService {
  private readonly repository = new ApplicationRepository();
  private storage: R2StorageService | undefined;

  private getStorage(): R2StorageService {
    this.storage ??= new R2StorageService();
    return this.storage;
  }

  async joinTalentNetwork(input: unknown): Promise<TalentNetworkResult> {
    const validated = this.validateInput(input);
    const email = validated.email.trim().toLowerCase();

    try {
      const result = await prisma.$transaction(async (tx) => {
        const existingCandidate = await this.repository.findCandidateByEmail(tx, email);

        const resume = validated.resume;
        await this.getStorage().verifyUploadedResume(
          resume.uploadId,
          resume.storageKey,
          resume.mimeType,
          resume.size,
        );

        const candidate = await this.repository.upsertCandidate(
          tx,
          {
            email,
            firstName: validated.firstName.trim(),
            lastName: validated.lastName.trim(),
            phone: validated.phone,
            location: validated.location,
            linkedinUrl: validated.linkedinUrl,
            portfolioUrl: validated.portfolioUrl,
            githubUrl: validated.githubUrl,
            currentCompany: validated.currentCompany,
            currentTitle: validated.currentTitle,
            yearsExperience: validated.yearsExperience,
            desiredSalary: undefined,
            noticePeriod: undefined,
          },
          existingCandidate?.id,
        );

        const existingMetadata =
          (candidate.metadata as unknown as Record<string, unknown> | null) ??
          null;
        const extraMetadata: Record<string, unknown> = {};
        if (validated.certifications)
          extraMetadata.certifications = validated.certifications;
        if (validated.additionalNotes)
          extraMetadata.additionalNotes = validated.additionalNotes;

        const updated = await this.repository.setTalentPoolConsent(tx, candidate.id, {
          contactConsentAt: new Date(),
          consentSource: "CAREERS_SITE",
          metadata:
            Object.keys(extraMetadata).length > 0
              ? { ...existingMetadata, ...extraMetadata }
              : undefined,
        });

        await this.repository.createResumeDocument(tx, {
          candidateId: candidate.id,
          storageKey: resume.storageKey,
          fileName: resume.fileName,
          mimeType: resume.mimeType,
          size: resume.size,
        });

        return {
          id: updated.id,
          firstName: updated.firstName,
          lastName: updated.lastName,
          email: updated.email ?? null,
          inTalentPool: updated.inTalentPool,
          contactConsent: updated.contactConsent,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };
      });

      return result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error(
        "Talent network signup failed:",
        error instanceof Error ? error.message : String(error),
      );
      throw new AppError("INTERNAL_ERROR", "Internal server error", 500);
    }
  }

  private validateInput(input: unknown): TalentNetworkInput {
    if (typeof input !== "object" || input === null) {
      throw new AppError("VALIDATION_ERROR", "Invalid request body", 400);
    }

    const body = input as Record<string, unknown>;

    const requiredFields = [
      "firstName",
      "lastName",
      "email",
      "resume",
      "contactConsent",
    ];
    const missing = requiredFields.filter((field) => {
      if (field === "contactConsent") return body[field] !== true;
      if (field === "resume")
        return typeof body[field] !== "object" || body[field] === null;
      return typeof body[field] !== "string" || !(body[field] as string).trim();
    });

    if (missing.length > 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Missing required fields: ${missing.join(", ")}`,
        400,
      );
    }

    const firstName = (body.firstName as string).trim();
    const lastName = (body.lastName as string).trim();
    const email = (body.email as string).trim().toLowerCase();

    if (!EMAIL_REGEX.test(email)) {
      throw new AppError("VALIDATION_ERROR", "Invalid email address", 400);
    }

    const resumeRaw = body.resume as Record<string, unknown>;
    const uploadId = sanitizeString(resumeRaw.uploadId);
    const storageKey = sanitizeString(resumeRaw.storageKey);
    const fileName = sanitizeString(resumeRaw.fileName);
    const mimeType = sanitizeString(resumeRaw.mimeType);
    const size = sanitizeNumber(resumeRaw.size);

    if (!uploadId || !storageKey || !fileName || !mimeType || size === undefined) {
      throw new AppError(
        "VALIDATION_ERROR",
        "resume.uploadId, storageKey, fileName, mimeType, and size are required",
        400,
      );
    }

    if (!UUID_REGEX.test(uploadId)) {
      throw new AppError("VALIDATION_ERROR", "Invalid resume uploadId", 400);
    }

    return {
      firstName,
      lastName,
      email,
      phone: sanitizeString(body.phone),
      location: sanitizeString(body.location),
      currentCompany: sanitizeString(body.currentCompany),
      currentTitle: sanitizeString(body.currentTitle),
      yearsExperience: sanitizeNumber(body.yearsExperience),
      linkedinUrl: sanitizeString(body.linkedinUrl),
      portfolioUrl: sanitizeString(body.portfolioUrl),
      githubUrl: sanitizeString(body.githubUrl),
      certifications: sanitizeString(body.certifications),
      additionalNotes: sanitizeString(body.additionalNotes),
      resume: { uploadId, storageKey, fileName, mimeType, size },
      contactConsent: true,
    };
  }
}
