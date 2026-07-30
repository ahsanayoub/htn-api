export interface JobContent {
    summary?: string;
  
    responsibilities: string[];
  
    requirements: string[];
  
    preferredQualifications: string[];
  
    benefits: string[];
  
    compensation?: string;
  
    aboutCompany?: string;
  
    additionalSections: Record<string, string[]>;
  }