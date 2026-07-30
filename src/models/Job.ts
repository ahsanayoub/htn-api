export interface HTNJob {
    source: string;
    sourceJobId: string;

    title: string;
    company: string;
    description: string;

    responsibilities?: string;
    requirements?: string;
    preferredQualifications?: string;

    employmentType: string | null;
    workHours: string | null;
    locationType: string | null;

    skills: string[];

    applyUrl: string;

    postedDate: string | null;
    validThrough: string | null;

    remote: boolean;
}