import "dotenv/config";
import { handleMessage } from "./message.handler.js";

import {
    DeleteMessageCommand,
    ReceiveMessageCommand,
} from "@aws-sdk/client-sqs";

import { sqs } from "../lib/sqs.js";
import type { JobMessageDTO } from "../dto/job-message.dto.js";

async function pollQueue(): Promise<void> {
    console.log("🚀 Queue worker started...");

    while (true) {
        try {
            const response = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: process.env.SQS_QUEUE_URL!,
                    MaxNumberOfMessages: 1,
                    WaitTimeSeconds: 20, // Long polling
                })
            );

            const messages = response.Messages ?? [];

            if (messages.length === 0) {
                continue;
            }

            for (const message of messages) {
                if (!message.Body || !message.ReceiptHandle) {
                    continue;
                }

                const payload = JSON.parse(message.Body) as JobMessageDTO;

                console.log("📩 Received message:");
                await handleMessage(payload);

                // TODO:
                // await handleMessage(payload);

                await sqs.send(
                    new DeleteMessageCommand({
                        QueueUrl: process.env.SQS_QUEUE_URL!,
                        ReceiptHandle: message.ReceiptHandle,
                    })
                );

                console.log("✅ Message deleted");
            }
        } catch (error) {
            console.error("❌ Worker error:", error);
        }
    }
}

pollQueue();