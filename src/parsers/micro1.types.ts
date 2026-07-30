export interface JobPostingSchema {
    "@context": string;
    "@type": "JobPosting";
  
    title: string;
    description: string;
  
    datePosted?: string;
    validThrough?: string;
  
    employmentType?: string | null;
    workHours?: string;
  
    jobLocationType?: string;
  
    directApply?: boolean;
  
    skills?: string[];
  
    hiringOrganization?: {
      "@type": "Organization";
      name: string;
      sameAs?: string;
    };
  
    applicantLocationRequirements?: {
      "@type": "Country";
      name: string;
    }[];
  }
  
  export interface Micro1ApplicationState {
    job_status?: string;
  
    referral_reward?: number;
  
    openings?: number;
  
    role_type?: string;
  
    company?: {
      id?: string;
      name?: string;
      logo_url?: string;
    };
  
    compensation?: {
      hourly_min?: number;
      hourly_max?: number;
  
      monthly_min?: number;
      monthly_max?: number;
  
      yearly?: number;
    };
  
    qualifying_questions?: Micro1Question[];
  }
  
  export interface Micro1Question {
    id: string;
  
    question: string;
  
    required: boolean;
  
    type: string;
  
    options?: string[];
  }