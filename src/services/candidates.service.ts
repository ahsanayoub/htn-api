import prisma from "../prisma/client.js";
import { ApplicationSource, ApplicationStatus, CandidateStatus, OrganizationType } from "@prisma/client";

export interface CreateApplicationInput {
  jobId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  linkedinUrl?: string;
  location: string;
  currentCompany?: string;
  currentTitle?: string;
  yearsExperience?: number;
  desiredSalary?: number;
  noticePeriod?: number;
  coverLetter?: string;
  additionalNotes?: string;
  certificationAcknowledged: boolean;
}

export async function createApplication(input: CreateApplicationInput) {
  const email = input.email.trim().toLowerCase();

  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({
      where: { id: input.jobId },
      select: { id: true, title: true },
    });

    if (!job) throw new Error("JOB_NOT_FOUND");

    const existingApplication = await tx.application.findFirst({
      where: { jobId: input.jobId, candidate: { email } },
      select: { id: true },
    });

    if (existingApplication) throw new Error("ALREADY_APPLIED");

    let currentOrganizationId: string | undefined;
    if (input.currentCompany?.trim()) {
      const companyName = input.currentCompany.trim();
      const existingOrganization = await tx.organization.findFirst({
        where: { name: companyName },
        select: { id: true },
      });
      if (existingOrganization) {
        currentOrganizationId = existingOrganization.id;
      } else {
        const organization = await tx.organization.create({
          data: { name: companyName, type: OrganizationType.COMPANY },
          select: { id: true },
        });
        currentOrganizationId = organization.id;
      }
    }

    let candidate = await tx.candidate.findFirst({ where: { email } });

    if (candidate) {
      candidate = await tx.candidate.update({
        where: { id: candidate.id },
        data: {
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          phone: input.phone?.trim() || null,
          linkedinUrl: input.linkedinUrl?.trim() || null,
          location: input.location.trim(),
          city: input.location.trim(),
          currentTitle: input.currentTitle?.trim() || null,
          yearsExperience: input.yearsExperience ?? null,
          currentOrganizationId: currentOrganizationId ?? candidate.currentOrganizationId,
          status: candidate.status === CandidateStatus.NEW ? CandidateStatus.ACTIVE : candidate.status,
        },
      });
    } else {
      candidate = await tx.candidate.create({
        data: {
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          email,
          phone: input.phone?.trim() || null,
          linkedinUrl: input.linkedinUrl?.trim() || null,
          location: input.location.trim(),
          city: input.location.trim(),
          currentTitle: input.currentTitle?.trim() || null,
          yearsExperience: input.yearsExperience ?? null,
          currentOrganizationId,
          status: CandidateStatus.ACTIVE,
        },
      });
    }

    return tx.application.create({
      data: {
        candidateId: candidate.id,
        jobId: input.jobId,
        status: ApplicationStatus.APPLIED,
        source: ApplicationSource.CAREERS_SITE,
        coverLetter: input.coverLetter?.trim() || null,
        additionalNotes: input.additionalNotes?.trim() || null,
        salaryExpectation: input.desiredSalary ?? null,
        noticePeriod: input.noticePeriod ?? null,
        submittedAt: new Date(),
        metadata: { certificationAcknowledged: input.certificationAcknowledged },
      },
      include: { job: { select: { id: true, title: true } } },
    });
  });
}
