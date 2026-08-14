import prisma from "../prisma/client.js";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  EmploymentType,
  JobSource,
  JobStatus,
  WorkplaceType,
} from "@prisma/client";

const JOB_INCLUDES = {
  organization: true,
  jobSkills: { include: { skill: true } },
} as const;

export type JobWithRelations = Prisma.JobGetPayload<{
  include: typeof JOB_INCLUDES;
}>;

export interface JobQueryParams {
  search?: string;
  company?: string;
  remote?: boolean;
  employmentType?: string;
  locationType?: string;
  posted?: number;
  sort?: "newest" | "oldest";
  source?: string;
  page?: number;
  limit?: number;
}

export interface JobUpsertData {
  externalId: string;
  source: JobSource;
  title: string;
  organizationId: string;
  description?: string | null;
  summary?: string | null;
  responsibilities?: string | null;
  requirements?: string | null;
  preferredQualifications?: string | null;
  benefits?: string | null;
  employmentType?: EmploymentType | null;
  workplaceType?: WorkplaceType | null;
  remote?: boolean | null;
  postedAt?: Date | null;
  expiresAt?: Date | null;
  applyUrl?: string | null;
  canonicalUrl?: string | null;
  status?: JobStatus;
  sourceVersion?: string | null;
  skillNames?: string[];
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  location?: string | null;
  country?: string | null;
  lastSeenAt?: Date | null;
  lastSyncedAt?: Date | null;
  metadata?: Prisma.InputJsonValue | null;
}

const EMPLOYMENT_TYPE_MAP: Record<string, EmploymentType> = {
  FULL_TIME: EmploymentType.FULL_TIME,
  PART_TIME: EmploymentType.PART_TIME,
  CONTRACT: EmploymentType.CONTRACT,
  TEMPORARY: EmploymentType.TEMPORARY,
  INTERNSHIP: EmploymentType.INTERNSHIP,
  INTERN: EmploymentType.INTERNSHIP,
  FREELANCE: EmploymentType.FREELANCE,
  VOLUNTEER: EmploymentType.VOLUNTEER,
};

const WORKPLACE_TYPE_MAP: Record<string, WorkplaceType> = {
  REMOTE: WorkplaceType.REMOTE,
  TELECOMMUTE: WorkplaceType.REMOTE,
  HYBRID: WorkplaceType.HYBRID,
  ON_SITE: WorkplaceType.ON_SITE,
  ONSITE: WorkplaceType.ON_SITE,
  "ON-SITE": WorkplaceType.ON_SITE,
  "ON SITE": WorkplaceType.ON_SITE,
};

const JOB_SOURCE_MAP: Record<string, JobSource> = {
  MICRO1: JobSource.MICRO1,
  GREENHOUSE: JobSource.GREENHOUSE,
  LEVER: JobSource.LEVER,
  ASHBY: JobSource.ASHBY,
  WORKDAY: JobSource.WORKDAY,
  LINKEDIN: JobSource.LINKEDIN,
  MANUAL: JobSource.MANUAL,
  OTHER: JobSource.OTHER,
};

function toEmploymentType(value: string | undefined): EmploymentType | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase().replace(/[-\s]/g, "_");
  return EMPLOYMENT_TYPE_MAP[normalized];
}

function toWorkplaceType(value: string | undefined): WorkplaceType | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase().replace(/[-\s]/g, "_");
  return WORKPLACE_TYPE_MAP[normalized];
}

function toJobSource(value: string | undefined): JobSource | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase().replace(/[-\s]/g, "_");
  return JOB_SOURCE_MAP[normalized];
}

export class JobRepository {
  async findMany(params: JobQueryParams): Promise<{
    jobs: JobWithRelations[];
    total: number;
  }> {
    const where = this.buildWhereClause(params);
    const orderBy = this.buildOrderBy(params.sort);
    const skip = ((params.page ?? 1) - 1) * (params.limit ?? 20);
    const take = params.limit ?? 20;

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({ where, orderBy, skip, take, include: JOB_INCLUDES }),
      prisma.job.count({ where }),
    ]);

    return { jobs, total };
  }

  async findByExternalId(externalId: string): Promise<JobWithRelations | null> {
    return prisma.job.findFirst({
      where: { externalId },
      include: JOB_INCLUDES,
    });
  }

  async upsert(data: JobUpsertData): Promise<"created" | "updated"> {
    const { wasExisting, jobId } = await prisma.$transaction(async (tx) => {
      const existing = await tx.job.findFirst({
        where: {
          source: data.source,
          externalId: data.externalId,
        },
        select: { id: true },
      });

      const job = await tx.job.upsert({
        where: {
          source_externalId: {
            source: data.source,
            externalId: data.externalId,
          },
        },
        create: {
          externalId: data.externalId,
          source: data.source,
          title: data.title,
          organization: { connect: { id: data.organizationId } },
          description: data.description,
          summary: data.summary,
          responsibilities: data.responsibilities,
          requirements: data.requirements,
          preferredQualifications: data.preferredQualifications,
          benefits: data.benefits,
          employmentType: data.employmentType,
          workplaceType: data.workplaceType,
          remote: data.remote,
          postedAt: data.postedAt,
          expiresAt: data.expiresAt,
          applyUrl: data.applyUrl,
          canonicalUrl: data.canonicalUrl,
          status: data.status ?? JobStatus.IMPORTED,
          sourceVersion: data.sourceVersion,
          salaryMin: data.salaryMin,
          salaryMax: data.salaryMax,
          salaryCurrency: data.salaryCurrency,
          location: data.location,
          country: data.country,
          lastSeenAt: data.lastSeenAt,
          lastSyncedAt: data.lastSyncedAt,
          metadata: data.metadata ?? {},
        },
        update: {
          title: data.title,
          description: data.description,
          summary: data.summary,
          responsibilities: data.responsibilities,
          requirements: data.requirements,
          preferredQualifications: data.preferredQualifications,
          benefits: data.benefits,
          employmentType: data.employmentType,
          workplaceType: data.workplaceType,
          remote: data.remote,
          postedAt: data.postedAt,
          expiresAt: data.expiresAt,
          applyUrl: data.applyUrl,
          canonicalUrl: data.canonicalUrl,
          status: data.status ?? JobStatus.IMPORTED,
          sourceVersion: data.sourceVersion,
          salaryMin: data.salaryMin,
          salaryMax: data.salaryMax,
          salaryCurrency: data.salaryCurrency,
          location: data.location,
          country: data.country,
          lastSeenAt: data.lastSeenAt,
          lastSyncedAt: data.lastSyncedAt,
        },
      });

      return { wasExisting: !!existing, jobId: job.id };
    });

    if (data.skillNames && data.skillNames.length > 0) {
      await this.addSkills(prisma, jobId, data.skillNames);
    }

    return wasExisting ? "updated" : "created";
  }

  async findStaleJobs(
    source: JobSource,
    since: Date,
  ): Promise<{ id: string; externalId: string | null }[]> {
    return prisma.job.findMany({
      where: {
        source,
        OR: [
          { lastSeenAt: { lt: since } },
          { lastSeenAt: null },
        ],
      },
      select: { id: true, externalId: true },
    });
  }

  async markStaleJobsAsClosed(source: JobSource, since: Date): Promise<number> {
    const result = await prisma.job.updateMany({
      where: {
        source,
        lastSeenAt: { lt: since },
        status: { notIn: [JobStatus.CLOSED, JobStatus.ARCHIVED] },
      },
      data: { status: JobStatus.CLOSED },
    });
    return result.count;
  }

  async addSkills(
    client: PrismaClient,
    jobId: string,
    skillNames: string[]
  ): Promise<void> {
    const trimmed = skillNames
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (trimmed.length === 0) return;

    const existing = await client.skill.findMany({
      where: { name: { in: trimmed, mode: "insensitive" } },
      select: { id: true, name: true },
    });

    const existingLower = new Set(
      existing.map((s) => s.name.toLowerCase()),
    );

    const newNames = trimmed.filter(
      (n) => !existingLower.has(n.toLowerCase()),
    );

    if (newNames.length > 0) {
      await client.skill.createMany({
        data: newNames.map((name) => ({ name })),
        skipDuplicates: true,
      });
    }

    const allSkills = await client.skill.findMany({
      where: { name: { in: trimmed, mode: "insensitive" } },
      select: { id: true },
    });

    const skillIds = allSkills.map((s) => s.id);

    if (skillIds.length === 0) return;

    await client.jobSkill.createMany({
      data: skillIds.map((skillId) => ({ jobId, skillId })),
      skipDuplicates: true,
    });
  }

  private buildWhereClause(params: JobQueryParams): Prisma.JobWhereInput {
    const where: Prisma.JobWhereInput = {};

    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: "insensitive" } },
        { description: { contains: params.search, mode: "insensitive" } },
        { responsibilities: { contains: params.search, mode: "insensitive" } },
        { requirements: { contains: params.search, mode: "insensitive" } },
        { preferredQualifications: { contains: params.search, mode: "insensitive" } },
        { organization: { name: { contains: params.search, mode: "insensitive" } } },
        {
          jobSkills: {
            some: { skill: { name: { contains: params.search, mode: "insensitive" } } },
          },
        },
      ];
    }

    if (params.company) {
      where.organization = { name: { equals: params.company } };
    }

    if (params.remote !== undefined) {
      where.remote = params.remote;
    }

    if (params.employmentType) {
      const et = toEmploymentType(params.employmentType);
      if (et) {
        where.employmentType = { equals: et };
      }
    }

    if (params.locationType) {
      const wt = toWorkplaceType(params.locationType);
      if (wt) {
        where.workplaceType = { equals: wt };
      }
    }

    if (params.source) {
      const sc = toJobSource(params.source);
      if (sc) {
        where.source = { equals: sc };
      }
    }

    if (params.posted) {
      const cutoff = new Date();
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - params.posted);
      where.postedAt = { gte: cutoff };
    }

    return where;
  }

  private buildOrderBy(sort: "newest" | "oldest" | undefined) {
    return { postedAt: sort === "oldest" ? ("asc" as const) : ("desc" as const) };
  }
}
