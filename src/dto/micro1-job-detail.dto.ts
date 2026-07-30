import { JobContent } from "../extractors/job-content/job-content.model.js";

export interface Micro1JobDetailDTO {
  source: string;

  externalId: string;

  canonicalUrl?: string;

  title: string;

  description: string;
  descriptionHtml: string;
  content: JobContent;

  company: {
    id: string;
    name: string;
    logoUrl?: string;
  };

  location: {
    type: "remote" | "hybrid" | "onsite" | "unknown";
    name?: string;
    countries?: string[];
  };

  employmentType?: string;

  compensation: {
    hourlyMin?: number;
    hourlyMax?: number;

    monthlyMin?: number;
    monthlyMax?: number;

    yearly?: number;

    referralReward?: number;
  };

  status?: string;

  roleType?: string;

  domain?: string;

  skills: string[];

  screeningQuestions: Micro1ScreeningQuestion[];

  openings?: number;

  postedAt?: Date;

  validUntil?: Date;

  directApply: boolean;
}

export interface Micro1ScreeningQuestion {
  id: string;
  question: string;
  type: string;
  required: boolean;
  options?: string[];
}