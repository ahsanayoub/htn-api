import { Micro1JobDetailDTO } from "../dto/micro1-job.dto";
import { Micro1JobPayload } from "./micro1.payload";
import { JobPostingSchema } from "./micro1.types";
import { NextFlightDecoder } from "./decoders/next-flight.decoder";
import { HtmlCleaner } from "../extractors/job-content/html-cleaner.js";
import { SectionExtractor } from "../extractors/job-content/section-extractor.js";

export class Micro1Parser {
  private readonly htmlCleaner = new HtmlCleaner();

  private readonly sectionExtractor = new SectionExtractor();
  parse(html: string): Micro1JobDetailDTO {
    const payloads = this.extractFlightPayloads(html);

    const jobPosting = this.parseJobPosting(payloads);

    const jobPayload = this.parseMicro1Payload(payloads);

    return this.buildDTO(jobPosting, jobPayload);
  }

  // ---------------------------------------------------
  // DTO Builder
  // --------------------------------------------------
    

  private buildDTO(
    schema: JobPostingSchema,
    payload: Micro1JobPayload
  ): Micro1JobDetailDTO {

    const cleaned = this.htmlCleaner.clean(schema.description);

console.dir(cleaned, { depth: null });

const content = this.sectionExtractor.extract(cleaned.html);

    return {
      source: "micro1",

      externalId: payload.client_job_id,

      title: payload.job_role_name,

      description: cleaned.text,
      descriptionHtml: cleaned.html,

      content,

      status: payload.job_status,

      company: {
        id: payload.client_details.client_id,
        name: payload.client_details.client_name,
        logoUrl: payload.client_details.user_image,
      },

      location: {
        type:
          schema.jobLocationType === "TELECOMMUTE"
            ? "remote"
            : "unknown",

        name: payload.location_name || undefined,

        countries:
          schema.applicantLocationRequirements?.map((c) => c.name),
      },

      employmentType: schema.employmentType ?? undefined,

      roleType: payload.role_type,

      domain: payload.domain_slug,

      compensation: {
        hourlyMin: payload.ideal_hourly_rate?.min,
        hourlyMax: payload.ideal_hourly_rate?.max,

        monthlyMin: payload.ideal_monthly_salary_min ?? undefined,
        monthlyMax: payload.ideal_monthly_salary_max ?? undefined,

        yearly: payload.ideal_yearly_compensation ?? undefined,

        referralReward: Number(payload.referral_reward_amount),
      },

      skills: payload.required_skills,

      screeningQuestions:
        payload.job_qualifying_question_list.map((q) => ({
          id: q.job_screening_question_id,
          question: q.question_text,
          type: q.answer_type,
          required: true,
          options: q.choice_options ?? undefined,
        })),

      openings: payload.no_of_openings,

      postedAt: new Date(payload.create_datetime),

      validUntil: schema.validThrough
        ? new Date(schema.validThrough)
        : undefined,

      directApply: schema.directApply ?? false,

      canonicalUrl: undefined,

      
    };
  }

  // ---------------------------------------------------
  // Parse JobPosting JSON-LD
  // ---------------------------------------------------

  private parseJobPosting(
    payloads: string[]
  ): JobPostingSchema {

    const payload = payloads.find((p) =>
      p.includes("JobPosting")
    );

    if (!payload) {
      throw new Error("JobPosting payload not found.");
    }

    const parsed = JSON.parse(payload);

    return JSON.parse(parsed[1]);
  }

  // ---------------------------------------------------
  // TEMP DEBUG
  // ---------------------------------------------------

  private parseMicro1Payload(
    payloads: string[]
  ): Micro1JobPayload {
  
    const decoder = new NextFlightDecoder();
  
    const objects = decoder.decode(payloads);
  
    const node = decoder.find<any>(
      objects,
      obj =>
        obj &&
        typeof obj === "object" &&
        obj.data?.client_job_id
    );
  
    if (!node) {
      throw new Error("Unable to locate Micro1 payload.");
    }
  
    return {
      ...node.data,
      job_qualifying_question_list:
        node.job_qualifying_question_list ?? [],
    };
  }

  // ---------------------------------------------------
  // React Flight Extractor
  // ---------------------------------------------------

  private extractFlightPayloads(html: string): string[] {

    const payloads: string[] = [];

    const marker = "self.__next_f.push(";

    let index = 0;

    while (true) {

      const start = html.indexOf(marker, index);

      if (start === -1) break;

      let i = start + marker.length;

      let depth = 1;
      let inString = false;
      let escaped = false;

      while (i < html.length) {

        const ch = html[i];

        if (escaped) {

          escaped = false;

        } else if (ch === "\\") {

          escaped = true;

        } else if (ch === '"') {

          inString = !inString;

        } else if (!inString) {

          if (ch === "(") depth++;

          if (ch === ")") depth--;

          if (depth === 0) {

            payloads.push(
              html.substring(start + marker.length, i)
            );

            index = i + 1;
            break;
          }
        }

        i++;
      }
    }

    return payloads;
  }
}