export interface Micro1JobSummaryDTO {
    job_id: string;

    job_name: string;

    company_name: string;

    date_posted: string;

    skills: string[];

    role_type: string;

    domain_slug: string;

    job_type: string;

    apply_url: string;

    location_type: string | null;

    engagement_type: string | null;
}