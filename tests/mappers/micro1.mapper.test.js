export class Micro1Processor {
    client;
    parser;
    mapper;
    constructor(client, parser, mapper) {
        this.client = client;
        this.parser = parser;
        this.mapper = mapper;
    }
    async process(url) {
        const html = await this.client.fetch(url);
        const dto = this.parser.parse(html);
        return this.mapper.map(dto);
    }
}
