-- Durable HTN → ATS sync for Talent Network candidate ingestion (no Application).
-- Reuses existing HtnAtsSyncStatus enum.
-- Do NOT apply to production from this implementation pass.

CREATE TABLE "HtnAtsCandidateSync" (
    "id" UUID NOT NULL,
    "htnCandidateId" UUID NOT NULL,
    "status" "HtnAtsSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorCode" TEXT,
    "atsCandidateId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HtnAtsCandidateSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HtnAtsCandidateSync_htnCandidateId_key" ON "HtnAtsCandidateSync"("htnCandidateId");

CREATE INDEX "HtnAtsCandidateSync_status_nextRetryAt_idx" ON "HtnAtsCandidateSync"("status", "nextRetryAt");

ALTER TABLE "HtnAtsCandidateSync" ADD CONSTRAINT "HtnAtsCandidateSync_htnCandidateId_fkey" FOREIGN KEY ("htnCandidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
