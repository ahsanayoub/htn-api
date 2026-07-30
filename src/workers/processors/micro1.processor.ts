import type { JobMessageDTO } from "../../dto/job-message.dto.js";
import { micro1Client } from "../../clients/micro1.client.js";
import { micro1Parser } from "../../parsers/micro1.parser.js";
import { writeFile } from "node:fs/promises";
import { Micro1JobDetailDTO } from "../../dto/micro1-job-detail.dto.js";

export async function processMicro1(
    message: JobMessageDTO
): Promise<void> {
    console.log("Job URL:", message.jobUrl);

    const html = await micro1Client.getJobPage(message.jobUrl);

const job: Micro1JobDetailDTO = micro1Parser.parse(html);

console.log(job);
}