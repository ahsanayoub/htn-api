import type { Job as ApiJob } from "../types/job.js";
import type { JobWithRelations } from "../repositories/job.repository.js";
import type {
  JobSource,
  WorkplaceType,
} from "@prisma/client";

function sourceToString(source: JobSource | null | undefined): string {
  if (!source) return "";
  return source.toLowerCase();
}

const WORKPLACE_TYPE_TO_API: Record<WorkplaceType, string | null> = {
  REMOTE: "Remote",
  HYBRID: "Hybrid",
  ON_SITE: "Onsite",
};

function workplaceTypeToString(
  wt: WorkplaceType | null | undefined
): string | null {
  if (!wt) return null;
  return WORKPLACE_TYPE_TO_API[wt] ?? null;
}

export function mapNotionJob(page: any): ApiJob {
    const props = page.properties;

    return {
        jobId:
            props["Job ID"]?.rich_text?.[0]?.plain_text ?? "",

        title:
            props["Job Title"]?.title?.[0]?.plain_text ?? "",

        company:
            props["Company"]?.rich_text?.[0]?.plain_text ?? "",

        description:
            props["Job Description"]?.rich_text?.[0]?.plain_text ?? "",

        employmentType:
            props["Employment Type"]?.select?.name ?? null,

        locationType:
            props["Location Type"]?.select?.name ?? null,

        postedDate:
            props["Posted Date"]?.date?.start ?? null,

        applyUrl:
            props["Apply URL"]?.url ?? "",

        source:
            props["Source"]?.select?.name ?? "",

        responsibilities:
            props["Responsibilities"]?.rich_text?.[0]?.plain_text ?? "",

        requirements:
            props["Requirements"]?.rich_text?.[0]?.plain_text ?? "",

        preferredQualifications:
            props["Preferred Qualifications"]?.rich_text?.[0]?.plain_text ?? "",

        skills:
            props["Required Skills"]?.multi_select?.map(
                (skill: any) => skill.name
            ) ?? [],

        remote:
            props["Location Type"]?.select?.name === "TELECOMMUTE"
    };
}

export function mapPrismaJobToApiJob(prismaJob: JobWithRelations): ApiJob {
    return {
        jobId: prismaJob.externalId ?? "",

        title: prismaJob.title,

        company: prismaJob.organization?.name ?? "",

        description: prismaJob.description ?? "",

        employmentType: prismaJob.employmentType ?? null,

        locationType: workplaceTypeToString(prismaJob.workplaceType),

        postedDate: prismaJob.postedAt
            ? new Date(prismaJob.postedAt).toISOString()
            : null,

        applyUrl: prismaJob.applyUrl ?? "",

        source: sourceToString(prismaJob.source),

        responsibilities: prismaJob.responsibilities ?? "",

        requirements: prismaJob.requirements ?? "",

        preferredQualifications: prismaJob.preferredQualifications ?? "",

        skills: prismaJob.jobSkills.map((js) => js.skill.name),

        remote: prismaJob.remote ?? false,
    };
}
