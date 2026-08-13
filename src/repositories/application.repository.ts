import { Prisma, OrganizationType, ApplicationStatus, ApplicationSource } from "@prisma/client";

const APPLICATION_INCLUDES = {
  candidate: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  },
  job: {
    select: {
      id: true,
      title: true,
      status: true,
    },
  },
} as const;

export type ApplicationWithRelations = Prisma.ApplicationGetPayload<{
  include: typeof APPLICATION_INCLUDES;
}>;

type Client = Prisma.TransactionClient;

export interface CandidateData {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  linkedinUrl?: string | null;
  portfolioUrl?: string | null;
  githubUrl?: string | null;
  location?: string | null;
  currentCompany?: string | null;
  currentTitle?: string | null;
  yearsExperience?: number | null;
  desiredSalary?: number | null;
  noticePeriod?: number | null;
}

export interface ApplicationData {
  candidateId: string;
  jobId: string;
  status: ApplicationStatus;
  submittedAt: Date;
  source: ApplicationSource;
  additionalNotes?: string | null;
  coverLetter?: string | null;
  salaryExpectation?: number | null;
  noticePeriod?: number | null;
  metadata?: Prisma.InputJsonValue;
}

export class ApplicationRepository {
  async findJobById(client: Client, jobId: string) {
    return client.job.findFirst({
      where: { externalId: jobId },
      select: { id: true, title: true, status: true },
    });
  }

  async findCandidateByEmail(client: Client, email: string) {
    return client.candidate.findFirst({
      where: { email },
    });
  }

  async findApplicationByCandidateAndJob(
    client: Client,
    candidateId: string,
    jobId: string,
  ) {
    return client.application.findFirst({
      where: { candidateId, jobId },
      select: { id: true },
    });
  }

  async upsertCandidate(
    client: Client,
    data: CandidateData,
    existingCandidateId?: string | null,
  ) {
    const { currentCompany, ...candidateFields } = data;

    let currentOrganizationId: string | undefined;

    if (currentCompany && currentCompany.trim()) {
      currentOrganizationId = await this.findOrCreateOrganization(
        client,
        currentCompany.trim(),
      );
    }

    if (existingCandidateId) {
      const updateData: Record<string, unknown> = {
        firstName: candidateFields.firstName,
        lastName: candidateFields.lastName,
        email: candidateFields.email,
      };

      if (candidateFields.phone && candidateFields.phone.trim()) {
        updateData.phone = candidateFields.phone.trim();
      }
      if (candidateFields.linkedinUrl && candidateFields.linkedinUrl.trim()) {
        updateData.linkedinUrl = candidateFields.linkedinUrl.trim();
      }
      if (candidateFields.portfolioUrl && candidateFields.portfolioUrl.trim()) {
        updateData.portfolioUrl = candidateFields.portfolioUrl.trim();
      }
      if (candidateFields.githubUrl && candidateFields.githubUrl.trim()) {
        updateData.githubUrl = candidateFields.githubUrl.trim();
      }
      if (candidateFields.location && candidateFields.location.trim()) {
        updateData.location = candidateFields.location.trim();
        updateData.city = candidateFields.location.trim();
      }
      if (candidateFields.currentTitle && candidateFields.currentTitle.trim()) {
        updateData.currentTitle = candidateFields.currentTitle.trim();
      }
      if (
        candidateFields.yearsExperience !== undefined &&
        candidateFields.yearsExperience !== null
      ) {
        updateData.yearsExperience = candidateFields.yearsExperience;
      }
      if (
        candidateFields.desiredSalary !== undefined &&
        candidateFields.desiredSalary !== null
      ) {
        updateData.desiredSalary = candidateFields.desiredSalary;
      }
      if (
        candidateFields.noticePeriod !== undefined &&
        candidateFields.noticePeriod !== null
      ) {
        updateData.noticePeriod = candidateFields.noticePeriod;
      }
      if (currentOrganizationId) {
        updateData.currentOrganizationId = currentOrganizationId;
      }

      return client.candidate.update({
        where: { id: existingCandidateId },
        data: updateData,
      });
    }

    return client.candidate.create({
      data: {
        ...candidateFields,
        city:
          candidateFields.location && candidateFields.location.trim()
            ? candidateFields.location.trim()
            : undefined,
        currentOrganizationId,
      },
    });
  }

  async createApplication(client: Client, data: ApplicationData) {
    return client.application.create({
      data: {
        candidateId: data.candidateId,
        jobId: data.jobId,
        status: data.status,
        submittedAt: data.submittedAt,
        source: data.source,
        coverLetter: data.coverLetter,
        additionalNotes: data.additionalNotes,
        salaryExpectation: data.salaryExpectation,
        noticePeriod: data.noticePeriod,
        metadata: data.metadata,
      },
      include: APPLICATION_INCLUDES,
    });
  }

  private async findOrCreateOrganization(
    client: Client,
    name: string,
  ): Promise<string> {
    const existing = await client.organization.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });

    if (existing) {
      return existing.id;
    }

    const created = await client.organization.create({
      data: {
        name,
        type: OrganizationType.COMPANY,
      },
      select: { id: true },
    });

    return created.id;
  }
}
