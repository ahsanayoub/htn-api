-- CreateEnum
CREATE TYPE "HtnAtsSyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'FAILED');

-- CreateTable
CREATE TABLE "HtnAtsSubmissionSync" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "status" "HtnAtsSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorCode" TEXT,
    "recruiterId" TEXT,
    "recruiterOrganizationId" TEXT,
    "atsCandidateId" TEXT,
    "atsApplicationId" TEXT,
    "atsJobId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HtnAtsSubmissionSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HtnAtsSubmissionSync_applicationId_key" ON "HtnAtsSubmissionSync"("applicationId");

-- CreateIndex
CREATE INDEX "HtnAtsSubmissionSync_status_nextRetryAt_idx" ON "HtnAtsSubmissionSync"("status", "nextRetryAt");

-- AddForeignKey
ALTER TABLE "HtnAtsSubmissionSync" ADD CONSTRAINT "HtnAtsSubmissionSync_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
