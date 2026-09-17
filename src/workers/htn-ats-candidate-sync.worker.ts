import "dotenv/config";
import { processDueTalentCandidateAtsSyncs } from "../services/htn-ats-candidate-sync.service.js";

export const HTN_ATS_CANDIDATE_SYNC_POLL_INTERVAL_MS = 15_000;

export function shouldStartHtnAtsCandidateSyncWorker(): boolean {
  if (process.env.VITEST) return false;
  if (process.env.NODE_ENV === "test") return false;
  const flag = process.env.HTN_ATS_CANDIDATE_SYNC_WORKER?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return true;
}

export function startHtnAtsCandidateSyncWorker(
  intervalMs = HTN_ATS_CANDIDATE_SYNC_POLL_INTERVAL_MS,
): NodeJS.Timeout | null {
  if (!shouldStartHtnAtsCandidateSyncWorker()) return null;

  const tick = async () => {
    try {
      await processDueTalentCandidateAtsSyncs({ limit: 10 });
    } catch (error) {
      console.error(
        "HTN ATS candidate sync worker tick failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  void tick();
  return setInterval(() => {
    void tick();
  }, intervalMs);
}

const isDirectRun = process.argv[1]?.includes("htn-ats-candidate-sync.worker");
if (isDirectRun) {
  console.log("HTN ATS talent candidate sync worker started");
  startHtnAtsCandidateSyncWorker();
}
