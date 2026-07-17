import { notion } from "./notion.js";

export async function getJobById(jobId: string) {
    console.log("Data Source ID:", process.env.NOTION_JOBS_DATA_SOURCE_ID);

    const response = await notion.dataSources.query({
        data_source_id: process.env.NOTION_JOBS_DATA_SOURCE_ID!,
        page_size: 1
    });

    console.log(JSON.stringify(response.results[0], null, 2));

    if (response.results.length === 0) {
        return null;
    }

    return response.results[0];
}