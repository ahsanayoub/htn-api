import { HTNJob } from "../models/htn-job.model.js";
import { notionProperties } from "../config/notion.properties.js";

export class NotionMapper {
  public map(job: HTNJob) {
    console.log("NOTION CONTENT");
    console.dir(job.content, { depth: null });

    const properties = {
      [notionProperties.title]: {
        title: [
          {
            text: {
              content: job.title,
            },
          },
        ],
      },

      [notionProperties.company]: {
        rich_text: [
          {
            text: {
              content: job.company.name,
            },
          },
        ],
      },

      [notionProperties.source]: {
        select: {
          name: job.source,
        },
      },

      [notionProperties.externalId]: {
        rich_text: [
          {
            text: {
              content: job.externalId,
            },
          },
        ],
      },

      [notionProperties.sourceUrl]: {
        url: job.sourceUrl ?? null,
      },

      [notionProperties.description]: this.richText(job.description),

      [notionProperties.summary]: this.richText(
        job.content?.summary
      ),

      [notionProperties.responsibilities]: this.bulletText(
        job.content?.responsibilities ?? []
      ),

      [notionProperties.requirements]: this.bulletText(
        job.content?.requirements ?? []
      ),

      [notionProperties.preferredQualifications]: this.bulletText(
        job.content?.preferredQualifications ?? []
      ),

      [notionProperties.benefits]: this.bulletText(
        job.content?.benefits ?? []
      ),

      [notionProperties.compensationDetails]: this.richText(
        job.content?.compensation
      ),

      [notionProperties.aboutCompany]: this.richText(
        job.content?.aboutCompany
      ),

      [notionProperties.status]: {
        status: {
          name: this.mapStatus(job.status),
        },
      },

      [notionProperties.skills]: {
        multi_select: job.skills.map((skill) => ({
          name: skill.replaceAll(",", " •"),
        })),
      },

      [notionProperties.employmentType]: {
        select: job.employmentType
          ? {
              name: job.employmentType,
            }
          : null,
      },

      [notionProperties.locationType]: {
        select: job.location
          ? {
              name: job.location.workModel,
            }
          : null,
      },

      [notionProperties.postedDate]: {
        date: job.postedAt
          ? {
              start: job.postedAt.toISOString(),
            }
          : null,
      },
    };

    console.log("NOTION PROPERTIES");
    console.dir(properties, { depth: null });

    console.log(
      "PREFERRED QUALIFICATIONS PROPERTY",
      properties[notionProperties.preferredQualifications]
    );

    return properties;
  }

  private richText(content?: string) {
    if (!content?.trim()) {
      return {
        rich_text: [],
      };
    }

    return {
      rich_text: [
        {
          text: {
            content: content.substring(0, 1900),
          },
        },
      ],
    };
  }

  private bulletText(items: string[]) {
    if (!items || items.length === 0) {
      return {
        rich_text: [],
      };
    }

    return {
      rich_text: [
        {
          text: {
            content: items
              .map((item) => `• ${item}`)
              .join("\n")
              .substring(0, 1900),
          },
        },
      ],
    };
  }

  private mapStatus(status?: string): string {
    switch ((status ?? "").toLowerCase()) {
      case "open":
      case "active":
      case "new":
        return "Open";

      case "paused":
        return "Paused";

      case "filled":
        return "Filled";

      case "archived":
        return "Archived";

      case "closed":
      case "expired":
        return "Closed";

      default:
        return "Open";
    }
  }
}