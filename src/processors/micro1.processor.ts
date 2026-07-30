import { Micro1Client } from "../clients/micro1.client.js";
import { Micro1Parser } from "../parsers/micro1.parser.js";
import { Micro1Mapper } from "../mappers/micro1.mapper.js";
import { HTNJob } from "../models/htn-job.model.js";

export class Micro1Processor {
  constructor(
    private readonly client: Micro1Client,
    private readonly parser: Micro1Parser,
    private readonly mapper: Micro1Mapper,
  ) {}

  async process(url: string): Promise<HTNJob> {
    const html = await this.client.fetch(url);

    const dto = this.parser.parse(html);

    return this.mapper.map(dto);
  }
}