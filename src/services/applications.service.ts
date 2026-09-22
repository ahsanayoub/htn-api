import { Prisma, ApplicationStatus, ApplicationSource, JobStatus } from "@prisma/client";
import prisma from "../prisma/client.js";
import { AppError } from "../errors/app-error.js";
import { ApplicationRepository } from "../repositories/application.repository.js";
import type { ApplicationWithRelations, ApplicationListFilters } from "../repositories/application.repository.js";
import { R2StorageService } from "./r2-storage.service.js";

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
  source?: ApplicationSource;
  recruiterId?: string;
  recruiterOrganizationId?: string;
  resume?: { uploadId: string; storageKey: string; fileName: string; mimeType: string; size: number };
}

function recruiterIdentityFromInput(input: CreateApplicationInput): { id: string; organizationId?: string } | undefined {
  if (!input.recruiterId) return undefined;
  return { id: input.recruiterId, organizationId: input.recruiterOrganizationId };
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

export class ApplicationService {
  private readonly repository = new ApplicationRepository();
  private storage: R2StorageService | undefined;

  private getStorage(): R2StorageService {
    this.storage ??= new R2StorageService();
    return this.storage;
  }

  async listApplications(filters: ApplicationListFilters = {}) {
    const page = Math.max(filters.page ?? 1, 1);
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const result = await this.repository.findMany({ ...filters, page, limit });
    const totalPages = Math.ceil(result.total / limit);
    return { applications: result.applications, pagination: { page, limit, total: result.total, totalPages, hasMore: page < totalPages } };
  }

  async getApplicationById(id: string) { return this.repository.findById(id); }

  async updateApplicationStatus(id: string, status: unknown) {
    if (typeof status !== "string" || !Object.values(ApplicationStatus).includes(status as ApplicationStatus)) {
      throw new AppError("VALIDATION_ERROR", "Invalid application status", 400);
    }
    const existing = await this.repository.findById(id);
    if (!existing) throw new AppError("APPLICATION_NOT_FOUND", "Application not found", 404);
    // Idempotent: same status is a no-op (no write / no outbound ATS sync side effects).
    if (existing.status === status) return existing;
    return this.repository.updateStatus(id, status as ApplicationStatus);
  }

  async createApplication(input: unknown): Promise<ApplicationWithRelations> {
    const validated = this.validateInput(input);
    const email = validated.email.trim().toLowerCase();
    try {
      return await prisma.$transaction(async (tx) => {
        const job = await this.repository.findJobById(tx, validated.jobId);
        if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
        if (job.status === JobStatus.CLOSED || job.status === JobStatus.ARCHIVED) throw new AppError("JOB_CLOSED", "Cannot apply to a closed or archived job", 409);
        const existingCandidate = await this.repository.findCandidateByEmail(tx, email);
        if (existingCandidate) {
          const existingApp = await this.repository.findApplicationByCandidateAndJob(tx, existingCandidate.id, job.id);
          if (existingApp) {
            // Recruiter submissions are idempotent at the HTN boundary. Returning an
            // existing recruiter application allows the route to retry ATS synchronization
            // after a transient ATS failure without creating a duplicate application.
            if (validated.source === ApplicationSource.RECRUITER && existingApp.source === ApplicationSource.RECRUITER) {
              const existingApplication = await this.repository.findByIdOn(tx, existingApp.id);
              if (existingApplication) {
                await this.repository.ensureAtsSyncRecord(tx, existingApplication.id, recruiterIdentityFromInput(validated));
                return existingApplication;
              }
            }
            throw new AppError("ALREADY_APPLIED", "You have already applied to this role.", 409);
          }
        }
        if (validated.resume) await this.getStorage().verifyUploadedResume(validated.resume.uploadId, validated.resume.storageKey, validated.resume.mimeType, validated.resume.size);
        const candidate = await this.repository.upsertCandidate(tx, {
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
        }, existingCandidate?.id);
        const metadata: Record<string, unknown> = {};
        if (validated.certifications) metadata.certifications = validated.certifications;
        if (validated.certificationAcknowledged !== undefined) metadata.certificationAcknowledged = validated.certificationAcknowledged;
        const application = await this.repository.createApplication(tx, {
          candidateId: candidate.id,
          jobId: job.id,
          status: ApplicationStatus.APPLIED,
          submittedAt: new Date(),
          source: validated.source ?? ApplicationSource.CAREERS_SITE,
          coverLetter: validated.coverLetter,
          additionalNotes: validated.additionalNotes,
          salaryExpectation: validated.desiredSalary,
          noticePeriod: validated.noticePeriod,
          metadata: Object.keys(metadata).length > 0 ? (metadata as Prisma.InputJsonValue) : undefined,
        });
        if (validated.resume) await this.repository.createResumeDocument(tx, { candidateId: candidate.id, storageKey: validated.resume.storageKey, fileName: validated.resume.fileName, mimeType: validated.resume.mimeType, size: validated.resume.size });
        if (validated.source === ApplicationSource.RECRUITER) await this.repository.ensureAtsSyncRecord(tx, application.id, recruiterIdentityFromInput(validated));
        return application;
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError("ALREADY_APPLIED", "You have already applied to this role.", 409);
      console.error("Application creation failed:", error instanceof Error ? error.message : String(error));
      throw new AppError("INTERNAL_ERROR", "Internal server error", 500);
    }
  }

  private validateInput(input: unknown): CreateApplicationInput {
    if (typeof input !== "object" || input === null) throw new AppError("VALIDATION_ERROR", "Invalid request body", 400);
    const body = input as Record<string, unknown>;
    const requiredFields = ["jobId", "firstName", "lastName", "email"];
    const missing = requiredFields.filter((field) => typeof body[field] !== "string" || !(body[field] as string).trim());
    if (missing.length > 0) throw new AppError("VALIDATION_ERROR", `Missing required fields: ${missing.join(", ")}`, 400);
    const jobId = (body.jobId as string).trim();
    if (!UUID_REGEX.test(jobId)) throw new AppError("VALIDATION_ERROR", "Invalid jobId: must be a valid UUID", 400);
    const email = (body.email as string).trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) throw new AppError("VALIDATION_ERROR", "Invalid email address", 400);
    let resume: CreateApplicationInput["resume"];
    if (body.resume !== undefined) {
      if (typeof body.resume !== "object" || body.resume === null) throw new AppError("VALIDATION_ERROR", "Invalid resume payload", 400);
      const value = body.resume as Record<string, unknown>;
      const uploadId = sanitizeString(value.uploadId), storageKey = sanitizeString(value.storageKey), fileName = sanitizeString(value.fileName), mimeType = sanitizeString(value.mimeType), size = sanitizeNumber(value.size);
      if (!uploadId || !storageKey || !fileName || !mimeType || size === undefined) throw new AppError("VALIDATION_ERROR", "resume.uploadId, storageKey, fileName, mimeType, and size are required", 400);
      if (!UUID_REGEX.test(uploadId)) throw new AppError("VALIDATION_ERROR", "Invalid resume uploadId", 400);
      resume = { uploadId, storageKey, fileName, mimeType, size };
    }
    const source = typeof body.source === "string" && Object.values(ApplicationSource).includes(body.source as ApplicationSource) ? body.source as ApplicationSource : undefined;
    return {
      jobId, firstName: (body.firstName as string).trim(), lastName: (body.lastName as string).trim(), email,
      phone: sanitizeString(body.phone), currentCompany: sanitizeString(body.currentCompany), currentTitle: sanitizeString(body.currentTitle), yearsExperience: sanitizeNumber(body.yearsExperience), desiredSalary: sanitizeNumber(body.desiredSalary), noticePeriod: sanitizeNumber(body.noticePeriod), linkedinUrl: sanitizeString(body.linkedinUrl), portfolioUrl: sanitizeString(body.portfolioUrl), githubUrl: sanitizeString(body.githubUrl), additionalNotes: sanitizeString(body.additionalNotes), certifications: sanitizeString(body.certifications), location: sanitizeString(body.location), certificationAcknowledged: typeof body.certificationAcknowledged === "boolean" ? body.certificationAcknowledged : undefined, coverLetter: sanitizeString(body.coverLetter), source, recruiterId: sanitizeString(body.recruiterId), recruiterOrganizationId: sanitizeString(body.recruiterOrganizationId), resume,
    };
  }
}
