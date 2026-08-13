import { Prisma, ApplicationStatus, ApplicationSource, JobStatus } from "@prisma/client";
import prisma from "../prisma/client.js";
import { AppError } from "../errors/app-error.js";
import { ApplicationRepository } from "../repositories/application.repository.js";
import type { ApplicationWithRelations } from "../repositories/application.repository.js";

export interface CreateApplicationInput {
  jobId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  currentCompany?: string;
  currentTitle?: string;
  yearsExperience?: number;
  desiredSalary?: number;
  noticePeriod?: number;
  linkedinUrl?: string;
  portfolioUrl?: string;
  githubUrl?: string;
  additionalNotes?: string;
  certifications?: string;
  location?: string;
  certificationAcknowledged?: boolean;
  coverLetter?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function sanitizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }
  return undefined;
}

export class ApplicationService {
  private readonly repository = new ApplicationRepository();

  async createApplication(
    input: unknown,
  ): Promise<ApplicationWithRelations> {
    const validated = this.validateInput(input);

    const email = validated.email.trim().toLowerCase();

    try {
      const application = await prisma.$transaction(async (tx) => {
        const job = await this.repository.findJobById(tx, validated.jobId);

        if (!job) {
          throw new AppError(
            "JOB_NOT_FOUND",
            "Job not found",
            404,
          );
        }

        if (job.status === JobStatus.CLOSED || job.status === JobStatus.ARCHIVED) {
          throw new AppError(
            "JOB_CLOSED",
            "Cannot apply to a closed or archived job",
            409,
          );
        }

        const existingCandidate = await this.repository.findCandidateByEmail(
          tx,
          email,
        );

        if (existingCandidate) {
          const existingApp =
            await this.repository.findApplicationByCandidateAndJob(
              tx,
              existingCandidate.id,
              job.id,
            );

          if (existingApp) {
            throw new AppError(
              "ALREADY_APPLIED",
              "You have already applied to this role.",
              409,
            );
          }
        }

        const candidateData = {
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
          desiredSalary: validated.desiredSalary,
          noticePeriod: validated.noticePeriod,
        };

        const candidate = await this.repository.upsertCandidate(
          tx,
          candidateData,
          existingCandidate?.id,
        );

        const metadata: Record<string, unknown> = {};
        if (validated.certifications) {
          metadata.certifications = validated.certifications;
        }
        if (validated.certificationAcknowledged !== undefined) {
          metadata.certificationAcknowledged =
            validated.certificationAcknowledged;
        }

        return this.repository.createApplication(tx, {
          candidateId: candidate.id,
          jobId: job.id,
          status: ApplicationStatus.APPLIED,
          submittedAt: new Date(),
          source: ApplicationSource.CAREERS_SITE,
          coverLetter: validated.coverLetter,
          additionalNotes: validated.additionalNotes,
          salaryExpectation: validated.desiredSalary,
          noticePeriod: validated.noticePeriod,
          metadata:
            Object.keys(metadata).length > 0
              ? (metadata as Prisma.InputJsonValue)
              : undefined,
        });
      });

      return application;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(
          "ALREADY_APPLIED",
          "You have already applied to this role.",
          409,
        );
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Application creation failed:", errorMessage);

      throw new AppError(
        "INTERNAL_ERROR",
        "Internal server error",
        500,
      );
    }
  }

  private validateInput(input: unknown): CreateApplicationInput {
    if (typeof input !== "object" || input === null) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Invalid request body",
        400,
      );
    }

    const body = input as Record<string, unknown>;

    const requiredFields = ["jobId", "firstName", "lastName", "email"];
    const missing = requiredFields.filter(
      (field) =>
        typeof body[field] !== "string" || !body[field].trim(),
    );

    if (missing.length > 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Missing required fields: ${missing.join(", ")}`,
        400,
      );
    }

    const jobId = (body.jobId as string).trim();

    if (!UUID_REGEX.test(jobId)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Invalid jobId: must be a valid UUID",
        400,
      );
    }

    const email = (body.email as string).trim().toLowerCase();

    if (!EMAIL_REGEX.test(email)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Invalid email address",
        400,
      );
    }

    return {
      jobId,
      firstName: (body.firstName as string).trim(),
      lastName: (body.lastName as string).trim(),
      email,
      phone: sanitizeString(body.phone),
      currentCompany: sanitizeString(body.currentCompany),
      currentTitle: sanitizeString(body.currentTitle),
      yearsExperience: sanitizeNumber(body.yearsExperience),
      desiredSalary: sanitizeNumber(body.desiredSalary),
      noticePeriod: sanitizeNumber(body.noticePeriod),
      linkedinUrl: sanitizeString(body.linkedinUrl),
      portfolioUrl: sanitizeString(body.portfolioUrl),
      githubUrl: sanitizeString(body.githubUrl),
      additionalNotes: sanitizeString(body.additionalNotes),
      certifications: sanitizeString(body.certifications),
      location: sanitizeString(body.location),
      certificationAcknowledged:
        typeof body.certificationAcknowledged === "boolean"
          ? body.certificationAcknowledged
          : undefined,
      coverLetter: sanitizeString(body.coverLetter),
    };
  }
}
