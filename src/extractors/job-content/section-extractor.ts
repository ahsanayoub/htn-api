import * as cheerio from "cheerio";

import { JobContent } from "./job-content.model.js";
import { HeadingNormalizer } from "./heading-normalizer.js";

export class SectionExtractor {
  private readonly normalizer = new HeadingNormalizer();

  public extract(html: string): JobContent {
    const $ = cheerio.load(html);

    const content: JobContent = {
      responsibilities: [],
      requirements: [],
      preferredQualifications: [],
      benefits: [],
      additionalSections: {},
    };

    let currentSection: string | null = null;

    $.root()
      .find("body")
      .contents()
      .each((_, element) => {
        const el = $(element);

        const text = el.text().replace(/\s+/g, " ").trim();

        if (!text) return;

        console.log({
          tag: el.prop("tagName"),
          text,
        });

        // Only heading-like elements should be normalized
        let heading: string | null = null;

        if (this.looksLikeHeading(el, text)) {
          heading = this.normalizer.normalize(text);

          if (heading) {
            console.log(`HEADING -> ${heading}: ${text}`);
            currentSection = heading;
            return;
          }
        }

        // No section yet -> treat the first meaningful paragraph as summary
        if (!currentSection) {
          if (
            text.startsWith("Role Title") ||
            text.startsWith("Job Title") ||
            text.startsWith("Role Type") ||
            text.startsWith("Job Type") ||
            text.startsWith("Location")
          ) {
            return;
          }

          if (!content.summary && text.length > 80) {
            content.summary = text;
          }

          return;
        }

        console.log(`SECTION [${currentSection}] -> ${text}`);

        switch (currentSection) {
          case "summary":
            content.summary = [content.summary, text]
              .filter(Boolean)
              .join("\n\n");
            break;

          case "responsibilities":
            this.extractList(el, content.responsibilities);
            break;

          case "requirements":
            this.extractList(el, content.requirements);
            break;

          case "preferredQualifications":
            this.extractList(el, content.preferredQualifications);
            break;

          case "benefits":
            this.extractList(el, content.benefits);
            break;

          case "compensation":
            content.compensation = [
              content.compensation,
              text,
            ]
              .filter(Boolean)
              .join("\n\n");
            break;

          case "aboutCompany":
            content.aboutCompany = [
              content.aboutCompany,
              text,
            ]
              .filter(Boolean)
              .join("\n\n");
            break;

          default:
            if (!content.additionalSections[currentSection]) {
              content.additionalSections[currentSection] = [];
            }

            content.additionalSections[currentSection].push(text);
        }
      });

    return content;
  }

  private looksLikeHeading(
    element: cheerio.Cheerio<any>,
    text: string
  ): boolean {
    const tag = element.prop("tagName")?.toLowerCase();

    // Real HTML headings are always headings
    if (["h1", "h2", "h3", "h4"].includes(tag ?? "")) {
      return true;
    }

    // Only paragraphs can act as pseudo-headings
    if (tag !== "p") {
      return false;
    }

    // Paragraphs that are too long are almost certainly body text
    if (text.length > 60) {
      return false;
    }

    // Full sentences are body text
    if (text.endsWith(".")) {
      return false;
    }

    return true;
  }

  private extractList(
    element: cheerio.Cheerio<any>,
    target: string[]
  ) {
    const tag = element.prop("tagName")?.toLowerCase();

    if (tag === "ul" || tag === "ol") {
      element.find("li").each((_, li) => {
        const text = element.find(li).text().trim();

        if (text) {
          target.push(text);
        }
      });

      return;
    }

    const text = element.text().trim();

    if (text) {
      target.push(text);
    }
  }
}