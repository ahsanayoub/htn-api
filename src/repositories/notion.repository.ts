import { notionClient } from "../lib/notion.client.js";
import { notionConfig } from "../config/notion.config.js";
import { HTNJob } from "../models/htn-job.model.js";
import { NotionMapper } from "../mappers/notion.mapper.js";

export class NotionRepository {
  private readonly mapper = new NotionMapper();

  async save(job: HTNJob): Promise<"created" | "updated"> {
    const pageId = await this.findByExternalId(job.externalId);
  
    if (pageId) {
      await this.update(pageId, job);
      return "updated";
    }
  
    await this.create(job);
    return "created";
  }

  private async findByExternalId(
    externalId: string,
  ): Promise<string | null> {
    console.log("Searching Job ID:", externalId);
  
    const response = await notionClient.dataSources.query({
      data_source_id: notionConfig.dataSourceId,
      filter: {
        property: "Job ID",
        rich_text: {
          equals: externalId,
        },
      },
      page_size: 1,
    });
  
    console.log("Matches:", response.results.length);
  
    if (response.results.length === 0) {
      return null;
    }
  
    console.log("Found page:", response.results[0].id);
  
    return response.results[0].id;
  }

  private async create(job: HTNJob): Promise<void> {
    await notionClient.pages.create({
      parent: {
        database_id: notionConfig.databaseId,
      },
      properties: this.mapper.map(job),
    });
  }

  private async update(pageId: string, job: HTNJob): Promise<void> {
    await notionClient.pages.update({
      page_id: pageId,
      properties: this.mapper.map(job),
    });
  }
}