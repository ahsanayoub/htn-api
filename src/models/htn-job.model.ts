import { JobContent } from "../extractors/job-content/job-content.model.js";

export interface HTNJob {
    id: string;
  
    source: string;
  
    externalId: string;
  
    sourceUrl?: string;
  
    title: string;
  
    company: {
      name: string;
      id?: string;
      logoUrl?: string;
    };
  
    description: string;
    
    content:JobContent;

    location?: {
      name?: string;
      workModel: "Remote" | "Hybrid" | "Onsite" | "Unknown";
      countries?: string[];
    };
  
    employmentType?: string;
  
    compensation?: {
      currency?: string;
    
      hourly?: {
        min?: number;
        max?: number;
      };
    
      monthly?: {
        min?: number;
        max?: number;
      };
    
      yearly?: number;
    
      referralReward?: number;
    };

    status?: string;

roleType?: string;

domain?: string;

openings?: number;

directApply: boolean;

postedAt?: Date;

expiresAt?: Date;
  
    skills: string[];
  
    screeningQuestions: ScreeningQuestion[];
  
    metadata: Record<string, unknown>;
  
    createdAt: Date;
  
    updatedAt: Date;
  }
  
  export interface ScreeningQuestion {
    id: string;
    question: string;
    type: string;
    options?: string[];
  }