export class Micro1Processor {
    constructor(
        private readonly client: Micro1Client,
        private readonly parser: Micro1Parser,
        private readonly mapper: Micro1Mapper
    ) {}

    async process(url: string): Promise<HTNJob> {
        const html = await this.client.fetch(url);

        const dto = this.parser.parse(html);

        return this.mapper.map(dto);
    }
}