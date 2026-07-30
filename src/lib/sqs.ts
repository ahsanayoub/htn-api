import { SQSClient } from "@aws-sdk/client-sqs";

export const sqs = new SQSClient({
    region: process.env.AWS_REGION,
});