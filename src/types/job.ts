export interface Job {
    jobId: string;

    title: string;

    company: string;

    description: string;

    employmentType: string | null;

    locationType: string | null;

    postedDate: string | null;

    applyUrl: string;

    /**
     * Recruiter outreach URL (e.g. Micro1 referral with referralCode).
     * Only present when the careers jobs API is called with a valid ATS integration key.
     * Never required for public/anonymous careers consumers.
     */
    referralUrl?: string | null;

    source: string;

    responsibilities: string;

    requirements: string;

    preferredQualifications: string;

    skills: string[];

    remote: boolean;
}