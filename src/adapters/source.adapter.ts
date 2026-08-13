import { JobSource } from "@prisma/client";
import type { HTNJob } from "../models/htn-job.model.js";
import type { JobUpsertData } from "../repositories/job.repository.js";

export interface SourceJobSummary {
  applyUrl: string;
  title: string;
  companyName: string;
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
