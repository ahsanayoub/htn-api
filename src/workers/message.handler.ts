import type { JobMessageDTO } from "../dto/job-message.dto.js";
import { processMicro1 } from "./processors/micro1.processor.js";

export async function handleMessage(
    message: JobMessageDTO
): Promise<void> {
    switch (message.source) {
        case "micro1":
            await processMicro1(message);
            break;

        default:
            throw new Error(`Unknown source: ${message.source}`);
    }
}