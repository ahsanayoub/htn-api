import dotenv from "dotenv";
import { Client } from "@notionhq/client";

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

async function main() {
  const response = await notion.search({
    filter: {
      property: "object",
      value: "data_source",
    },
  });

  console.dir(response.results, { depth: null });
}

main().catch(console.error);