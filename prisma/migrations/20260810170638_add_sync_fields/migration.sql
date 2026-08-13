-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SourceSync" (
    "id" UUID NOT NULL,
    "source" "JobSource" NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStart" TIMESTAMP(3),
    "totalSeen" INTEGER,
    "totalCreated" INTEGER,
    "totalUpdated" INTEGER,
    "totalFailed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SourceSync_source_key" ON "SourceSync"("source");

-- CreateIndex
CREATE INDEX "Job_lastSeenAt_idx" ON "Job"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Job_lastSyncedAt_idx" ON "Job"("lastSyncedAt");
