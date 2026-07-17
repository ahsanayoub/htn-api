import * as cheerio from "cheerio";
import type { HTNJob } from "../models/Job.js";

export function extractMicro1(
    html: string,
    url: string
) {
    const $ = cheerio.load(html);

    let payload = "";

    $("script").each((_, el) => {
        const text = $(el).html() ?? "";

        if (text.includes("JobPosting")) {
            payload = text;
        }
    });

    if (!payload) {
        return {
            success: false,
            message: "JobPosting not found"
        };
    }

    // Find beginning of JSON
    const start = payload.indexOf("{\\\"@context");

    // Find end of JSON
    const end = payload.lastIndexOf("}\"");

    let json = payload.substring(start, end + 1);

    // Unescape JSON
    json = json
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");

    console.log("About to parse JSON...");

    const job = JSON.parse(json);

    const plainDescription = cheerio
        .load(job.description ?? "")
        .text()
        .replace(/\s+/g, " ")
        .trim();

    console.log("Original:", (job.description ?? "").substring(0, 100));
    console.log("Plain:", plainDescription.substring(0, 100));

    console.log("JSON parsed successfully!");

    // Extract clean Job ID (without query parameters)
    const parsedUrl = new URL(url);
    const sourceJobId = parsedUrl.pathname.split("/").pop() ?? "";

    const htnJob: HTNJob = {
        source: "micro1",

        sourceJobId,

        title: job.title,

        company: job.hiringOrganization?.name ?? "",

        description: plainDescription.substring(0, 1900),

        employmentType: job.employmentType,

        workHours: job.workHours,

        locationType: job.jobLocationType,

        skills: job.skills ?? [],

        applyUrl: url,

        postedDate: job.datePosted,

        validThrough: job.validThrough,

        remote: job.jobLocationType === "TELECOMMUTE"
    };

    console.log("Extracted Job ID:", sourceJobId);
    console.log("Final description:", htnJob.description.substring(0, 100));

    return {
        success: true,
        job: htnJob
    };
}