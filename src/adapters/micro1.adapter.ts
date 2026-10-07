import { JobSource, EmploymentType, WorkplaceType, JobStatus } from "@prisma/client";
import type { Micro1Client } from "../clients/micro1.client.js";
import type { Micro1Processor } from "../processors/micro1.processor.js";
import type { HTNJob } from "../models/htn-job.model.js";
import type { JobUpsertData } from "../repositories/job.repository.js";
import type { SourceAdapter, SourceJobSummary } from "./source.adapter.js";
import type { Micro1JobSummaryDTO } from "../dto/micro1-job-summary.dto.js";
import {
  getMicro1DiscoverySource,
  MICRO1_ELIGIBLE_JOBS_PAGE_LIMIT,
} from "../config/micro1.config.js";

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

/** Referral Dashboard: apply_url is fetch URL + persisted referralUrl (not HTN applyUrl). */
function mapReferralSummaryDto(summary: Micro1JobSummaryDTO): SourceJobSummary {
  return {
    applyUrl: summary.apply_url,
    referralUrl: summary.apply_url,
    title: summary.job_name,
    companyName: summary.company_name,
    externalId: summary.job_id,
  };
}

/** Public get_all_jobs: preserve legacy applyUrl/canonicalUrl mapping; not referralUrl. */
function mapPublicSummaryDto(summary: Micro1JobSummaryDTO): SourceJobSummary {
  return {
    applyUrl: summary.apply_url,
    title: summary.job_name,
    companyName: summary.company_name,
    externalId: summary.job_id,
  };
}

function dedupeSummariesByJobId(
  summaries: Micro1JobSummaryDTO[],
): { unique: Micro1JobSummaryDTO[]; duplicatesRemoved: number } {
  const seen = new Set<string>();
  const unique: Micro1JobSummaryDTO[] = [];
  let duplicatesRemoved = 0;

  for (const summary of summaries) {
    const id = summary.job_id;
    if (!id || seen.has(id)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(id);
    unique.push(summary);
  }

  return { unique, duplicatesRemoved };
}

export class Micro1SyncAdapter implements SourceAdapter {
  readonly source = JobSource.MICRO1;

  constructor(
    private readonly client: Micro1Client,
    private readonly processor: Micro1Processor,
  ) {}

  async getJobSummaries(syncStart: Date): Promise<SourceJobSummary[]> {
    const discoverySource = getMicro1DiscoverySource();

    if (discoverySource === "referral") {
      return this.getReferralJobSummaries();
    }

    return this.getPublicJobSummaries();
  }

  /**
   * Referral Dashboard discovery (authoritative when configured).
   * Paginated GET /referral/portal/eligible-jobs with limit <= 100.
   */
  private async getReferralJobSummaries(): Promise<SourceJobSummary[]> {
    const pageLimit = MICRO1_ELIGIBLE_JOBS_PAGE_LIMIT;
    const allSummaries: Micro1JobSummaryDTO[] = [];
    let pagesFetched = 0;
    let reportedTotal: number | null = null;

    for (let page = 1; ; page++) {
      const portal = await this.client.getEligibleJobs(page, pageLimit);
      pagesFetched++;

      if (reportedTotal === null) {
        reportedTotal = portal.total;
      }

      if (!portal.data.length) {
        break;
      }

      allSummaries.push(...portal.data);

      if (reportedTotal !== null && allSummaries.length >= reportedTotal) {
        break;
      }

      if (portal.data.length < pageLimit) {
        break;
      }
    }

    if (allSummaries.length === 0) {
      console.log("Micro1 eligible jobs discovered: 0");
      console.log(`Micro1 pages fetched: ${pagesFetched}`);
      console.log("Micro1 duplicate summaries removed: 0");
      return [];
    }

    const { unique, duplicatesRemoved } = dedupeSummariesByJobId(allSummaries);

    console.log(`Micro1 eligible jobs discovered: ${unique.length}`);
    console.log(`Micro1 pages fetched: ${pagesFetched}`);
    console.log(`Micro1 duplicate summaries removed: ${duplicatesRemoved}`);

    return unique.map(mapReferralSummaryDto);
  }

  /**
   * Legacy public portal discovery (fallback).
   * POST /job/portal action=get_all_jobs filters.type=["EXPERT"].
   */
  private async getPublicJobSummaries(): Promise<SourceJobSummary[]> {
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

    return allSummaries.map(mapPublicSummaryDto);
  }

  async getJobDetails(summary: SourceJobSummary): Promise<HTNJob> {
    const job = await this.processor.process(summary.applyUrl);
    const isReferral = typeof summary.referralUrl === "string" && summary.referralUrl.length > 0;

    // Prefer detail externalId when present; fall back to discovery job_id.
    // Referral: persist feed apply_url as referralUrl only — do not drive HTN applyUrl.
    // Public: re-attach summary URL onto sourceUrl for legacy applyUrl/canonicalUrl mapping.
    return {
      ...job,
      ...(isReferral
        ? { referralUrl: summary.referralUrl }
        : { sourceUrl: summary.applyUrl }),
      externalId: job.externalId || summary.externalId || job.externalId,
    };
  }

  mapToUpsertData(job: HTNJob, organizationId: string, syncStart: Date): JobUpsertData {
    const { type: workplaceType, remote } = mapWorkplaceType(job.location?.workModel);

    const salaryMin = job.compensation?.monthly?.min ?? job.compensation?.hourly?.min ?? null;
    const salaryMax = job.compensation?.monthly?.max ?? job.compensation?.hourly?.max ?? null;

    const isReferral =
      typeof job.referralUrl === "string" && job.referralUrl.length > 0;

    const base: JobUpsertData = {
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

    if (isReferral) {
      // Referral Dashboard: store outreach URL separately. Do not set or synthesize
      // HTN applyUrl / do not copy referral URL into canonicalUrl.
      return {
        ...base,
        referralUrl: job.referralUrl,
      };
    }

    // Public/legacy Micro1 path: preserve prior applyUrl + canonicalUrl behavior.
    return {
      ...base,
      applyUrl: job.sourceUrl ?? null,
      canonicalUrl: job.sourceUrl ?? null,
    };
  }
}
