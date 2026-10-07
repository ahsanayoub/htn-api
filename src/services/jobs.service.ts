import { JobRepository } from "../repositories/job.repository.js";
import { mapPrismaJobToApiJob } from "../mappers/job.mapper.js";
import { JobStatus, JobVisibility } from "@prisma/client";
import type { Job } from "../types/job.js";

const jobRepository = new JobRepository();

export interface JobFilters {
    source?: string;
    company?: string;
    remote?: boolean;
    employmentType?: string;
    locationType?: string;
    search?: string;

    posted?: number;
    sort?: "newest" | "oldest";
    status?: JobStatus;
    /**
     * Public careers API always forces PUBLIC.
     * Callers that need INTERNAL (none currently on public routes) must opt in explicitly.
     */
    visibility?: JobVisibility;
}

export interface JobSearchResult {
    jobs: Job[];

    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasMore: boolean;
    };
}

export type JobsApiOptions = {
    /**
     * When true (ATS integration Bearer), include referralUrl on each job.
     * Anonymous / public careers callers must leave this false so referralCode URLs stay private.
     */
    includeReferralUrl?: boolean;
};

/**
 * Public job detail lookup.
 * Only returns PUBLIC jobs so INTERNAL ATS projections are not exposed by ID.
 * CLOSED + PUBLIC remains reachable (historical careers deep-link behavior).
 */
export async function getJobById(
    jobId: string,
    options: JobsApiOptions = {},
): Promise<Job | null> {
    const prismaJob = await jobRepository.findByExternalId(jobId, {
        visibility: JobVisibility.PUBLIC,
    });

    if (!prismaJob) {
        return null;
    }

    return mapPrismaJobToApiJob(prismaJob, {
        includeReferralUrl: options.includeReferralUrl,
    });
}

export async function getJobs(
    filters: JobFilters = {},
    page = 1,
    limit = 20,
    options: JobsApiOptions = {},
): Promise<JobSearchResult> {
    const { jobs: prismaJobs, total } = await jobRepository.findMany({
        search: filters.search,
        company: filters.company,
        remote: filters.remote,
        employmentType: filters.employmentType,
        locationType: filters.locationType,
        posted: filters.posted,
        sort: filters.sort ?? "newest",
        source: filters.source,
        page,
        limit,
        status: filters.status ?? JobStatus.ACTIVE,
        // Public safety boundary: never list INTERNAL jobs from this service.
        visibility: filters.visibility ?? JobVisibility.PUBLIC,
    });

    const totalPages = Math.ceil(total / limit);
    const mapOptions = { includeReferralUrl: options.includeReferralUrl };

    return {
        jobs: prismaJobs.map((job) => mapPrismaJobToApiJob(job, mapOptions)),

        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasMore: page < totalPages,
        },
    };
}
