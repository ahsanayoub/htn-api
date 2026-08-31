-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "consentSource" TEXT,
ADD COLUMN     "contactConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contactConsentAt" TIMESTAMP(3),
ADD COLUMN     "inTalentPool" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Candidate_inTalentPool_idx" ON "Candidate"("inTalentPool");

-- CreateIndex
CREATE INDEX "Candidate_contactConsent_idx" ON "Candidate"("contactConsent");
