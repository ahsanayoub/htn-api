import { JobSource, JobStatus } from "@prisma/client";

import type { JobUpsertData } from "../repositories/job.repository.js";
import type { ReferralInventoryCapture } from "./micro1-referral-inventory.js";

/**
 * Reasons a snapshot must not change job status.
 * An empty feed is rejected on purpose: absence closure is only valid after a
 * non-empty, complete eligible-jobs snapshot.
 */
export type EligibleSnapshotRejection =
  | "request_failed"
  | "invalid_total"
  | "incomplete_pagination"
  | "missing_job_id"
  | "duplicate_ids"
  | "empty_snapshot";

export type EligibleSnapshotDecision =
  | { ok: true; externalIds: string[] }
  | { ok: false; reason: EligibleSnapshotRejection };

export type Micro1EligibilityJob = {
  id: string;
  externalId: string | null;
  status: JobStatus;
  source: JobSource;
};

export type ReferralEligibilityChange = {
  id: string;
  externalId: string;
  fromStatus: JobStatus;
  toStatus: JobStatus;
};

export type ReferralEligibilityPlan = {
  create: string[];
  close: ReferralEligibilityChange[];
  reopen: ReferralEligibilityChange[];
};

const INVALID_TOTAL_NOTE = /numeric total|invalid total|reported total \d+ after|above the source-reported total/i;

/**
 * Accept a snapshot only when the eligible-jobs capture is complete, non-empty,
 * and free of duplicate job IDs. Any other shape leaves statuses unchanged.
 */
export function evaluateEligibleSnapshot(
  capture: ReferralInventoryCapture,
): EligibleSnapshotDecision {
  if (capture.failures.length > 0) {
    return { ok: false, reason: "request_failed" };
  }
  if (capture.invalidRows.length > 0) {
    return { ok: false, reason: "missing_job_id" };
  }
  if (capture.completionNotes.some((note) => INVALID_TOTAL_NOTE.test(note))) {
    return { ok: false, reason: "invalid_total" };
  }
  if (!capture.inventoryComplete) {
    return { ok: false, reason: "incomplete_pagination" };
  }
  if (
    capture.duplicateIds.length > 0 ||
    capture.jobs.some((job) => job.referralShapeConflict)
  ) {
    return { ok: false, reason: "duplicate_ids" };
  }
  if (capture.reportedTotal === 0 || capture.uniqueCount === 0 || capture.jobs.length === 0) {
    return { ok: false, reason: "empty_snapshot" };
  }

  return {
    ok: true,
    externalIds: capture.jobs.map((job) => job.jobId),
  };
}

/**
 * Compare one validated eligible-job ID set with stored jobs.
 * Only MICRO1 rows are eligible for create, close, or reopen.
 */
export function planMicro1ReferralEligibility(
  eligibleExternalIds: ReadonlySet<string>,
  existing: readonly Micro1EligibilityJob[],
): ReferralEligibilityPlan {
  const micro1ByExternalId = new Map<string, Micro1EligibilityJob>();

  for (const job of existing) {
    if (job.source !== JobSource.MICRO1) continue;
    const externalId = job.externalId?.trim();
    if (!externalId) continue;
    if (!micro1ByExternalId.has(externalId)) {
      micro1ByExternalId.set(externalId, job);
    }
  }

  const create: string[] = [];
  const close: ReferralEligibilityChange[] = [];
  const reopen: ReferralEligibilityChange[] = [];

  for (const externalId of eligibleExternalIds) {
    const job = micro1ByExternalId.get(externalId);
    if (!job) {
      create.push(externalId);
      continue;
    }
    if (job.status !== JobStatus.ACTIVE) {
      reopen.push({
        id: job.id,
        externalId,
        fromStatus: job.status,
        toStatus: JobStatus.ACTIVE,
      });
    }
  }

  for (const [externalId, job] of micro1ByExternalId) {
    if (eligibleExternalIds.has(externalId)) continue;
    if (job.status !== JobStatus.ACTIVE) continue;
    close.push({
      id: job.id,
      externalId,
      fromStatus: JobStatus.ACTIVE,
      toStatus: JobStatus.CLOSED,
    });
  }

  create.sort();
  close.sort((a, b) => a.externalId.localeCompare(b.externalId));
  reopen.sort((a, b) => a.externalId.localeCompare(b.externalId));

  return { create, close, reopen };
}

/** New eligible IDs use the existing upsert payload, forced active on create only. */
export function eligibilityCreateData(
  data: JobUpsertData,
  externalId: string,
): JobUpsertData {
  return {
    ...data,
    externalId,
    source: JobSource.MICRO1,
    status: JobStatus.ACTIVE,
    preserveStatusOnUpdate: true,
  };
}

export type ReferralEligibilityReport = {
  dryRun: boolean;
  applied: boolean;
  reason?: EligibleSnapshotRejection | "not_referral_discovery" | "reconciliation_already_running";
  eligibleCount: number;
  create: string[];
  close: ReferralEligibilityChange[];
  reopen: ReferralEligibilityChange[];
};

export async function reconcileMicro1ReferralEligibility(input: {
  dryRun: boolean;
  referralDiscovery: boolean;
  loadSnapshot: () => Promise<ReferralInventoryCapture>;
  listJobs: () => Promise<Micro1EligibilityJob[]>;
  setStatus: (id: string, status: JobStatus) => Promise<void>;
  createJob: (externalId: string) => Promise<void>;
  acquireLock?: () => Promise<boolean>;
  releaseLock?: () => Promise<void>;
}): Promise<ReferralEligibilityReport> {
  const empty = {
    dryRun: input.dryRun,
    applied: false,
    eligibleCount: 0,
    create: [] as string[],
    close: [] as ReferralEligibilityChange[],
    reopen: [] as ReferralEligibilityChange[],
  };

  if (!input.referralDiscovery) {
    return { ...empty, reason: "not_referral_discovery" };
  }

  const locked = input.acquireLock ? await input.acquireLock() : true;
  if (!locked) {
    return { ...empty, reason: "reconciliation_already_running" };
  }

  try {
    const capture = await input.loadSnapshot();
    const decision = evaluateEligibleSnapshot(capture);
    if (!decision.ok) {
      return { ...empty, reason: decision.reason };
    }

    const existing = await input.listJobs();
    const plan = planMicro1ReferralEligibility(new Set(decision.externalIds), existing);
    const report: ReferralEligibilityReport = {
      dryRun: input.dryRun,
      applied: !input.dryRun,
      eligibleCount: decision.externalIds.length,
      create: plan.create,
      close: plan.close,
      reopen: plan.reopen,
    };

    if (input.dryRun) {
      return { ...report, applied: false };
    }

    for (const change of plan.reopen) {
      await input.setStatus(change.id, JobStatus.ACTIVE);
    }
    for (const change of plan.close) {
      await input.setStatus(change.id, JobStatus.CLOSED);
    }
    for (const externalId of plan.create) {
      await input.createJob(externalId);
    }

    return report;
  } finally {
    if (input.releaseLock) await input.releaseLock();
  }
}
