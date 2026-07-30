import { SendMessageCommand } from "@aws-sdk/client-sqs";

import { sqs } from "../lib/sqs.js";

export async function sendMessage(message: unknown): Promise<void> {
    await sqs.send(
        new SendMessageCommand({
            QueueUrl: process.env.SQS_QUEUE_URL!,
            MessageBody: JSON.stringify(message),
        })
    );
}