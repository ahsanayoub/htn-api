export interface Micro1ScreeningQuestionDTO {
  id: string;
  question: string;
  type: string;
  options?: string[];
}

export interface Micro1JobDetailDTO {
  // Identity
  source: "micro1";
  externalId: string;

  // Basic Info
  title: string;
  description: string;
  status: string;

  // Company
  company: {
    id?: string;
    name: string;
    logoUrl?: string;
  };

  // Location
  location: {
    type: "remote" | "hybrid" | "onsite" | "unknown";
    name?: string;
    countries?: string[];
  };

  // Employment
  employmentType?: string;
  roleType?: string;
  domain?: string;

  // Compensation
  compensation: {
    hourlyMin?: number;
    hourlyMax?: number;

    monthlyMin?: number;
    monthlyMax?: number;

    yearly?: number;

    referralReward?: number;
  };

  // Skills
  skills: string[];

  // Screening
  screeningQuestions: Micro1ScreeningQuestionDTO[];

  // Hiring
  openings?: number;
  postedAt?: Date;
  validUntil?: Date;

  // Apply
  directApply: boolean;

  // Metadata
  canonicalUrl?: string;
}