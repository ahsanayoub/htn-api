import type { Job } from "../types/job.js";
export function mapNotionJob(page: any): Job {
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