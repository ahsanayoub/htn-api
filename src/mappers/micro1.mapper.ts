import { createHash } from "crypto";
import { Micro1JobDetailDTO } from "../dto/micro1-job-detail.dto.js";
import { HTNJob, ScreeningQuestion } from "../models/htn-job.model.js";

export class Micro1Mapper {
  public map(dto: Micro1JobDetailDTO): HTNJob {
    console.log(dto.content);
    console.log("CONTENT IN MAPPER");
    console.dir(dto.content, { depth: null });
    
    return {
      id: this.createId(dto),

      source: dto.source,
      externalId: dto.externalId,
      sourceUrl: dto.canonicalUrl,

      title: dto.title,
      description: dto.description,
      content: dto.content,

      company: dto.company,

      location: {
        name: dto.location.name,
        workModel: this.mapWorkModel(dto.location.type),
        countries: dto.location.countries,
      },

      employmentType: dto.employmentType,

      compensation: {
        hourly: {
          min: dto.compensation.hourlyMin,
          max: dto.compensation.hourlyMax,
        },
        monthly: {
          min: dto.compensation.monthlyMin,
          max: dto.compensation.monthlyMax,
        },
        yearly: dto.compensation.yearly,
        referralReward: dto.compensation.referralReward,
      },

      status: dto.status,
      roleType: dto.roleType,
      domain: dto.domain,

      openings: dto.openings,
      directApply: dto.directApply,
      postedAt: dto.postedAt,
      expiresAt: dto.validUntil,

      skills: dto.skills,

      screeningQuestions: dto.screeningQuestions.map((q): ScreeningQuestion => ({
        id: q.id,
        question: q.question,
        type: q.type,
        options: q.options,
      })),

      metadata: {},

      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
  }

  private createId(dto: Micro1JobDetailDTO): string {
    return createHash("sha256")
      .update(`${dto.source}:${dto.externalId}`)
      .digest("hex");
  }

  private mapWorkModel(
    type: "remote" | "hybrid" | "onsite" | "unknown"
  ): "Remote" | "Hybrid" | "Onsite" | "Unknown" {
    switch (type) {
      case "remote":
        return "Remote";
      case "hybrid":
        return "Hybrid";
      case "onsite":
        return "Onsite";
      default:
        return "Unknown";
    }
  }
}