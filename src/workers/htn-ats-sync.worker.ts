import "dotenv/config";
import { processDueAtsSyncs } from "../services/htn-ats-sync.service.js";

export const HTN_ATS_SYNC_POLL_INTERVAL_MS = 15_000;

export function shouldStartHtnAtsSyncWorker(): boolean {
  if (process.env.VITEST) return false;
  if (process.env.NODE_ENV === "test") return false;
  const flag = process.env.HTN_ATS_SYNC_WORKER?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return true;
}

export function startHtnAtsSyncWorker(intervalMs = HTN_ATS_SYNC_POLL_INTERVAL_MS): NodeJS.Timeout | null {
  if (!shouldStartHtnAtsSyncWorker()) return null;

  const tick = async () => {
    try {
      await processDueAtsSyncs({ limit: 10 });
    } catch (error) {
      console.error("HTN ATS sync worker tick failed:", error instanceof Error ? error.message : String(error));
    }
  };

  void tick();
  return setInterval(() => {
    void tick();
  }, intervalMs);
}

const isDirectRun = process.argv[1]?.includes("htn-ats-sync.worker");
if (isDirectRun) {
  console.log("HTN ATS submission sync worker started");
  startHtnAtsSyncWorker();
}
