export interface Job {
    jobId: string;

    title: string;

    company: string;

    description: string;

    employmentType: string | null;

    locationType: string | null;

    postedDate: string | null;

    applyUrl: string;

    source: string;

    responsibilities: string;

    requirements: string;

    preferredQualifications: string;

    skills: string[];

    remote: boolean;
}