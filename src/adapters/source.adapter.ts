import { JobSource } from "@prisma/client";
import type { HTNJob } from "../models/htn-job.model.js";
import type { JobUpsertData } from "../repositories/job.repository.js";

export interface SourceJobSummary {
  /** URL used to fetch source job details (may be a Micro1 listing/referral link). */
  applyUrl: string;
  title: string;
  companyName: string;
  /** Source-native job id when known at discovery time (e.g. Micro1 job_id). */
  externalId?: string;
  /**
   * Referral-attributed outreach URL when the discovery feed provides one
   * (e.g. Micro1 Referral Dashboard apply_url). Persisted as Job.referralUrl,
   * never as Job.applyUrl.
   */
  referralUrl?: string;
}

export interface SourceAdapter {
  readonly source: JobSource;

  getJobSummaries(syncStart: Date): Promise<SourceJobSummary[]>;

  getJobDetails(summary: SourceJobSummary): Promise<HTNJob>;

  mapToUpsertData(
    job: HTNJob,
    organizationId: string,
    syncStart: Date,
  ): JobUpsertData;
}
