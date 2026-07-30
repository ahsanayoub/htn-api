import fs from "fs";
import path from "path";

import { Micro1Parser } from "../../src/parsers/micro1.parser";

describe("Micro1Parser", () => {
  const parser = new Micro1Parser();

  const html = fs.readFileSync(
    path.join(__dirname, "../fixtures/micro1-job.html"),
    "utf8"
  );

  it("should parse a Micro1 job page", () => {
    const dto = parser.parse(html);

    expect(dto).toBeDefined();
  });
});