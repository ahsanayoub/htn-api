import {
    micro1Client,
    micro1Processor,
    jobRepository,
    organizationRepository,
} from "../index.js";
import {
    JobSource,
    EmploymentType,
    WorkplaceType,
    JobStatus,
} from "@prisma/client";
import type { JobUpsertData } from "../repositories/job.repository.js";
import type { HTNJob } from "../models/htn-job.model.js";

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

function mapJobToUpsertData(job: HTNJob, organizationId: string): JobUpsertData {
    const { type: workplaceType, remote } = mapWorkplaceType(job.location?.workModel);

    const salaryMin = job.compensation?.hourly?.min ?? job.compensation?.monthly?.min ?? null;
    const salaryMax = job.compensation?.hourly?.max ?? job.compensation?.monthly?.max ?? null;

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
        metadata: {
            ...job.metadata,
            compensationDetails: job.content?.compensation ?? null,
            aboutCompany: job.content?.aboutCompany ?? null,
        },
    };
}

async function saveJob(job: HTNJob): Promise<"created" | "updated"> {
    const orgId = await organizationRepository.findOrCreate({
        name: job.company.name,
    });

    return await jobRepository.upsert(
        mapJobToUpsertData(job, orgId)
    );
}

async function main() {
    const firstPage = await micro1Client.getJobs(1);

    if (!firstPage.data.length) {
        throw new Error("No jobs returned.");
    }

    const totalJobs = firstPage.total;
    const pageSize = firstPage.data.length;
    const totalPages = Math.ceil(totalJobs / pageSize);

    console.log(`Importing ${totalJobs} jobs across ${totalPages} pages...`);

    let created = 0;
    let updated = 0;
    let failed = 0;

    for (let page = 1; page <= totalPages; page++) {
        const portal =
            page === 1 ? firstPage : await micro1Client.getJobs(page);

        console.log(`\nPage ${page}/${totalPages}`);

        for (const summary of portal.data) {
            try {
                console.log(`Processing ${summary.job_name}`);

                const job = await micro1Processor.process(summary.apply_url);
                const result = await saveJob(job);

                if (result === "created") {
                    created++;
                } else {
                    updated++;
                }

                console.log(`${result.toUpperCase()}: ${job.title}`);
            } catch (err) {
                failed++;
                console.error(`Failed: ${summary.job_name}`, err);
            }
        }
    }

    console.log(`
    Import Complete
    ---------------
    Created : ${created}
    Updated : ${updated}
    Failed  : ${failed}
    `);
}

main().catch(console.error);