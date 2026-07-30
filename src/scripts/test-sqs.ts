import "dotenv/config";

import { sendMessage } from "../services/queue.service.js";

async function main() {
    await sendMessage({
        source: "micro1",
        jobId: "e878f562-71d9-4e8d-b7b2-ce7ff5c091f3",
        jobUrl:
            "https://jobs.micro1.ai/post/e878f562-71d9-4e8d-b7b2-ce7ff5c091f3?utm_source=micro1&utm_medium=job_portal",
    });

    console.log("✅ Message sent successfully.");
}

main().catch(console.error);