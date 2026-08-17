import { JobRepository } from "../repositories/job.repository.js";
import { mapPrismaJobToApiJob } from "../mappers/job.mapper.js";
import { JobStatus } from "@prisma/client";
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

export async function getJobById(jobId: string): Promise<Job | null> {
    const prismaJob = await jobRepository.findByExternalId(jobId);

    if (!prismaJob) {
        return null;
    }

    return mapPrismaJobToApiJob(prismaJob);
}

export async function getJobs(
    filters: JobFilters = {},
    page = 1,
    limit = 20
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
    });

    const totalPages = Math.ceil(total / limit);

    return {
        jobs: prismaJobs.map(mapPrismaJobToApiJob),

        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasMore: page < totalPages,
        },
    };
}
