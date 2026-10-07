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

    /** Present on Referral Dashboard eligible-jobs summaries. */
    ideal_hourly_rate?: number | null;
    ideal_monthly_rate?: number | null;
    ideal_yearly_rate?: number | null;
    no_of_openings?: number | null;
    referral_reward_amount?: number | null;
    is_high_demand_job?: boolean | null;
}