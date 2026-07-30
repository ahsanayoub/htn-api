import * as cheerio from "cheerio";

export interface CleanHtmlResult {
  html: string;
  text: string;
}

export class HtmlCleaner {
  public clean(html: string): CleanHtmlResult {
    const $ = cheerio.load(html);

    // Remove Quill editor UI elements
    $(".ql-ui").remove();

    // Remove scripts, styles and metadata
    $("script, style, meta, link").remove();

    // Remove comments
    $("*")
      .contents()
      .each((_, node) => {
        if (node.type === "comment") {
          $(node).remove();
        }
      });

    // Remove empty paragraphs
    $("p").each((_, p) => {
      const text = $(p).text().replace(/\u00A0/g, " ").trim();

      if (!text && $(p).children().length === 0) {
        $(p).remove();
      }
    });

    // Remove empty lists
    $("ul, ol").each((_, list) => {
      if ($(list).find("li").length === 0) {
        $(list).remove();
      }
    });

    // Remove useless attributes
    $("*").each((_, element) => {
      $(element)
        .removeAttr("style")
        .removeAttr("class")
        .removeAttr("id")
        .removeAttr("contenteditable")
        .removeAttr("data-list");
    });

    const cleanedHtml = $.html();

const text = $.root().text()
  .replace(/\u00A0/g, " ")
  .replace(/\s+/g, " ")
  .trim();

return {
  html: cleanedHtml,
  text,
};
  }
}