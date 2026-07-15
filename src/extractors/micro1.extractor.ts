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

    // Unescape
    json = json
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");

console.log("About to parse JSON...");

const job = JSON.parse(json);

console.log("JSON parsed successfully!");

const htnJob: HTNJob = {

        source: "micro1",

        sourceJobId: url.split("/").pop() ?? "",

        title: job.title,

        company: job.hiringOrganization?.name ?? "",

        description: job.description,

        employmentType: job.employmentType,

        workHours: job.workHours,

        locationType: job.jobLocationType,

        skills: job.skills ?? [],

        applyUrl: url,

        postedDate: job.datePosted,

        validThrough: job.validThrough,

        remote: job.jobLocationType === "TELECOMMUTE"

    };

    return {
        success: true,
        job: htnJob
    };

}