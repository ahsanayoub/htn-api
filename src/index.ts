import "dotenv/config";

import { Micro1Client } from "./clients/micro1.client.js";
import { Micro1Parser } from "./parsers/micro1.parser.js";
import { Micro1Mapper } from "./mappers/micro1.mapper.js";
import { Micro1Processor } from "./processors/micro1.processor.js";
import { NotionRepository } from "./repositories/notion.repository.js";

const micro1Client = new Micro1Client();
const micro1Parser = new Micro1Parser();
const micro1Mapper = new Micro1Mapper();

const notionRepository = new NotionRepository();

const micro1Processor = new Micro1Processor(
  micro1Client,
  micro1Parser,
  micro1Mapper
);

export {
  micro1Client,
  micro1Processor,
  notionRepository,
};