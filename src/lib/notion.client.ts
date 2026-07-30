import { Client } from "@notionhq/client";
import { notionConfig } from "../config/notion.config.js";

export const notionClient = new Client({
    auth: notionConfig.apiKey,
});