import { notion } from "./notion.js";
import { mapNotionJob } from "../mappers/job.mapper.js";
import type { Job } from "../types/job.js";

export interface JobFilters {
    source?: string;
    company?: string;
    remote?: boolean;
    employmentType?: string;
    locationType?: string;
    search?: string;

    posted?: number;
    sort?: "newest" | "oldest";
}

function buildNotionFilters(filters: JobFilters) {
    const andFilters: any[] = [];

    if (filters.source) {
        andFilters.push({
            property: "Source",
            rich_text: {
                equals: filters.source,
            },
        });
    }

    if (filters.company) {
        andFilters.push({
            property: "Company",
            rich_text: {
                equals: filters.company,
            },
        });
    }

    if (filters.remote !== undefined) {
        andFilters.push({
            property: "Remote",
            checkbox: {
                equals: filters.remote,
            },
        });
    }

    if (filters.employmentType) {
        andFilters.push({
            property: "Employment Type",
            select: {
                equals: filters.employmentType,
            },
        });
    }

    if (filters.locationType) {
        andFilters.push({
            property: "Location Type",
            select: {
                equals: filters.locationType,
            },
        });
    }

    return andFilters;
}

async function fetchAllJobsFromNotion(filters: JobFilters = {}) {
    const allJobs: Job[] = [];
    let cursor: string | undefined = undefined;
    let hasMore = true;

    const andFilters = buildNotionFilters(filters);

    while (hasMore) {
        const response = await notion.dataSources.query({
            data_source_id: process.env.NOTION_JOBS_DATA_SOURCE_ID!,
            page_size: 100,

            ...(cursor && {
                start_cursor: cursor,
            }),

            ...(andFilters.length > 0 && {
                filter: {
                    and: andFilters,
                },
            }),

            sorts: [
                {
                    property: "Posted Date",
                    direction: "descending",
                },
            ],
        });

        allJobs.push(...response.results.map(mapNotionJob));

        hasMore = response.has_more;
        cursor = response.next_cursor ?? undefined;
    }

    return allJobs;
}

function searchJobs(
    jobs: Job[],
    search?: string
): Job[] {
    if (!search) {
        return jobs;
    }

    const term = search.toLowerCase().trim();

    return jobs.filter(job =>
        (job.title ?? "").toLowerCase().includes(term) ||
        (job.company ?? "").toLowerCase().includes(term) ||
        (job.description ?? "").toLowerCase().includes(term) ||
        (job.responsibilities ?? "").toLowerCase().includes(term) ||
        (job.requirements ?? "").toLowerCase().includes(term) ||
        (job.preferredQualifications ?? "").toLowerCase().includes(term) ||
        job.skills.some(skill =>
            skill.toLowerCase().includes(term)
        )
    );
}

function filterPostedDate(
    jobs: Job[],
    days?: number
): Job[] {
    if (!days) {
        return jobs;
    }

    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - days);

    return jobs.filter(job => {
        if (!job.postedDate) {
            return false;
        }

        const posted = new Date(job.postedDate);

        return !Number.isNaN(posted.getTime()) &&
            posted >= cutoff;
    });
}

function sortJobs(
    jobs: Job[],
    direction: "newest" | "oldest" = "newest"
): Job[] {
    return [...jobs].sort((a, b) => {
        const first = new Date(a.postedDate ?? "").getTime();
        const second = new Date(b.postedDate ?? "").getTime();

        return direction === "oldest"
            ? first - second
            : second - first;
    });
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

function paginateJobs(
    jobs: Job[],
    page: number,
    limit: number
): JobSearchResult {
    const total = jobs.length;

    const totalPages = Math.ceil(total / limit);

    const start = (page - 1) * limit;

    const end = start + limit;

    return {
        jobs: jobs.slice(start, end),

        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasMore: page < totalPages,
        },
    };
}

export async function getJobById(jobId: string) {
    const response = await notion.dataSources.query({
        data_source_id: process.env.NOTION_JOBS_DATA_SOURCE_ID!,
        filter: {
            property: "Job ID",
            rich_text: {
                equals: jobId,
            },
        },
    });

    if (response.results.length === 0) {
        return null;
    }

    return mapNotionJob(response.results[0]);
}

export async function getJobs(
    filters: JobFilters = {},
    page = 1,
    limit = 20
): Promise<JobSearchResult> {
    let jobs = await fetchAllJobsFromNotion(filters);
    jobs = searchJobs(jobs, filters.search);

jobs = filterPostedDate(
    jobs,
    filters.posted
);

jobs = sortJobs(
    jobs,
    filters.sort ?? "newest"
);

return paginateJobs(jobs, page, limit);
}
