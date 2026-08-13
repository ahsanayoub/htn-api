import { JobSource, EmploymentType, WorkplaceType, JobStatus } from "@prisma/client";
import type { Micro1Client } from "../clients/micro1.client.js";
import type { Micro1Processor } from "../processors/micro1.processor.js";
import type { HTNJob } from "../models/htn-job.model.js";
import type { JobUpsertData } from "../repositories/job.repository.js";
import type { SourceAdapter, SourceJobSummary } from "./source.adapter.js";
import type { Micro1PortalResponseDTO } from "../dto/micro1-portal-response.dto.js";
import type { Micro1JobSummaryDTO } from "../dto/micro1-job-summary.dto.js";

const SOURCE_MAP: Record<string, JobSource> = {
  micro1: JobSource.MICRO1,
  greenhouse: JobSource.GREENHOUSE,
  lever: JobSource.LEVER,
  ashby: JobSource.ASHBY,
  workday: JobSource.WORKDAY,
  linkedin: JobSource.LINKEDIN,
  manual: JobSource.MANUAL,
  other: JobSource.OTHER,
};

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

const STATUS_MAP: Record<string, JobStatus> = {
  open: JobStatus.ACTIVE,
  active: JobStatus.ACTIVE,
  new: JobStatus.ACTIVE,
  paused: JobStatus.ON_HOLD,
  filled: JobStatus.CLOSED,
  closed: JobStatus.CLOSED,
  expired: JobStatus.CLOSED,
  archived: JobStatus.ARCHIVED,
};

const WORKPLACE_TYPE_MAP: Record<string, { type: WorkplaceType; remote: boolean }> = {
  Remote: { type: WorkplaceType.REMOTE, remote: true },
  Hybrid: { type: WorkplaceType.HYBRID, remote: true },
  Onsite: { type: WorkplaceType.ON_SITE, remote: false },
  Unknown: { type: WorkplaceType.ON_SITE, remote: false },
};

function joinArray(items: string[] | undefined): string | null {
  if (!items || items.length === 0) return null;
  return items.join("\n");
}

function mapSource(source: string): JobSource {
  return SOURCE_MAP[source.toLowerCase()] ?? JobSource.OTHER;
}

function mapEmploymentType(type?: string): EmploymentType | null {
  if (!type) return null;
  const normalized = type.toUpperCase().replace(/[-\s]/g, "_");
  return EMPLOYMENT_TYPE_MAP[normalized] ?? null;
}

function mapWorkplaceType(workModel?: string): { type: WorkplaceType | null; remote: boolean } {
  if (!workModel) return { type: null, remote: false };
  const mapped = WORKPLACE_TYPE_MAP[workModel];
  return mapped ?? { type: null, remote: false };
}

function mapStatus(status?: string): JobStatus {
  if (!status) return JobStatus.IMPORTED;
  return STATUS_MAP[status.toLowerCase()] ?? JobStatus.IMPORTED;
}

export class Micro1SyncAdapter implements SourceAdapter {
  readonly source = JobSource.MICRO1;

  constructor(
    private readonly client: Micro1Client,
    private readonly processor: Micro1Processor,
  ) {}

  async getJobSummaries(syncStart: Date): Promise<SourceJobSummary[]> {
    const firstPage = await this.client.getJobs(1);

    if (!firstPage.data.length) {
      throw new Error("No jobs returned from Micro1 portal.");
    }

    const totalJobs = firstPage.total;
    const pageSize = firstPage.data.length;
    const totalPages = Math.ceil(totalJobs / pageSize);

    console.log(`[Micro1] Fetching ${totalJobs} jobs across ${totalPages} pages...`);

    const allSummaries: Micro1JobSummaryDTO[] = [...firstPage.data];

    for (let page = 2; page <= totalPages; page++) {
      const portal = await this.client.getJobs(page);
      allSummaries.push(...portal.data);
      console.log(`[Micro1] Page ${page}/${totalPages}: ${portal.data.length} jobs`);
    }

    return allSummaries.map((summary) => ({
      applyUrl: summary.apply_url,
      title: summary.job_name,
      companyName: summary.company_name,
    }));
  }

  async getJobDetails(summary: SourceJobSummary): Promise<HTNJob> {
    return await this.processor.process(summary.applyUrl);
  }

  mapToUpsertData(job: HTNJob, organizationId: string, syncStart: Date): JobUpsertData {
    const { type: workplaceType, remote } = mapWorkplaceType(job.location?.workModel);

    const salaryMin = job.compensation?.monthly?.min ?? job.compensation?.hourly?.min ?? null;
    const salaryMax = job.compensation?.monthly?.max ?? job.compensation?.hourly?.max ?? null;

    return {
      externalId: job.externalId,
      source: mapSource(job.source),
      title: job.title,
      organizationId,
      description: job.description ?? null,
      summary: job.content?.summary ?? null,
      responsibilities: joinArray(job.content?.responsibilities),
      requirements: joinArray(job.content?.requirements),
      preferredQualifications: joinArray(job.content?.preferredQualifications),
      benefits: joinArray(job.content?.benefits),
      employmentType: mapEmploymentType(job.employmentType),
      workplaceType,
      remote,
      postedAt: job.postedAt ?? null,
      expiresAt: job.expiresAt ?? null,
      applyUrl: job.sourceUrl ?? null,
      canonicalUrl: job.sourceUrl ?? null,
      status: mapStatus(job.status),
      skillNames: job.skills,
      salaryMin,
      salaryMax,
      salaryCurrency: job.compensation?.currency ?? null,
      location: job.location?.name ?? null,
      country: job.location?.countries?.[0] ?? null,
      lastSeenAt: syncStart,
      lastSyncedAt: syncStart,
      metadata: {
        ...job.metadata,
        compensationDetails: job.content?.compensation ?? null,
        aboutCompany: job.content?.aboutCompany ?? null,
      },
    };
  }
}
