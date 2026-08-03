import type { JobMessageDTO } from "../../dto/job-message.dto.js";
import { Micro1Client } from "../../clients/micro1.client.js";
import { Micro1Parser } from "../../parsers/micro1.parser.js";
import { Micro1JobDetailDTO } from "../../dto/micro1-job-detail.dto.js";


const micro1Client = new Micro1Client();
const micro1Parser = new Micro1Parser();

export async function processMicro1(
    message: JobMessageDTO
): Promise<void> {
    console.log("Job URL:", message.jobUrl);

    const html = await micro1Client.fetch(message.jobUrl);

const job: Micro1JobDetailDTO = micro1Parser.parse(html);

console.log(job);
}