-- CreateEnum
CREATE TYPE "JobVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- AlterTable
ALTER TABLE "Job"
ADD COLUMN "visibility" "JobVisibility" NOT NULL DEFAULT 'PUBLIC';

-- Backfill: ATS-projected jobs are internal (covers MANUAL + OTHER HTN_ATS rows).
-- Does not change source, externalId, applications, or other columns.
UPDATE "Job"
SET "visibility" = 'INTERNAL'
WHERE metadata->>'integration' = 'HTN_ATS';

-- MICRO1 and remaining rows keep DEFAULT PUBLIC.

-- CreateIndex
CREATE INDEX "Job_status_visibility_idx" ON "Job"("status", "visibility");
