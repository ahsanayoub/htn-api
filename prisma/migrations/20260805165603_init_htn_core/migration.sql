-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('COMPANY', 'CLIENT', 'VENDOR', 'MSP', 'UNIVERSITY', 'HOSPITAL', 'PARTNER');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERNSHIP', 'FREELANCE', 'VOLUNTEER');

-- CreateEnum
CREATE TYPE "WorkplaceType" AS ENUM ('ON_SITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('RESUME', 'COVER_LETTER', 'CERTIFICATION', 'PORTFOLIO', 'OTHER');

-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('MICRO1', 'GREENHOUSE', 'LEVER', 'ASHBY', 'WORKDAY', 'LINKEDIN', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('IMPORTED', 'PARSED', 'VALIDATED', 'ACTIVE', 'ON_HOLD', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('NEW', 'ACTIVE', 'INTERVIEWING', 'PLACED', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApplicationSource" AS ENUM ('CAREERS_SITE', 'RECRUITER', 'REFERRAL', 'IMPORT', 'LINKEDIN', 'OTHER');

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "sourceVersion" TEXT,
    "type" "OrganizationType" NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "website" TEXT,
    "linkedinUrl" TEXT,
    "logoUrl" TEXT,
    "industry" TEXT,
    "description" TEXT,
    "headquarters" TEXT,
    "employeeCount" INTEGER,
    "foundedYear" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "sourceVersion" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "title" TEXT,
    "department" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" UUID NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "sourceVersion" TEXT,
    "source" "JobSource",
    "organizationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "summary" TEXT,
    "description" TEXT,
    "descriptionHtml" TEXT,
    "responsibilities" TEXT,
    "requirements" TEXT,
    "preferredQualifications" TEXT,
    "benefits" TEXT,
    "employmentType" "EmploymentType",
    "workplaceType" "WorkplaceType",
    "department" TEXT,
    "seniority" TEXT,
    "experienceMin" INTEGER,
    "experienceMax" INTEGER,
    "salaryMin" DECIMAL(65,30),
    "salaryMax" DECIMAL(65,30),
    "salaryCurrency" TEXT,
    "location" TEXT,
    "country" TEXT,
    "city" TEXT,
    "timezone" TEXT,
    "remote" BOOLEAN,
    "openings" INTEGER,
    "postedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "status" "JobStatus" NOT NULL DEFAULT 'IMPORTED',
    "applyUrl" TEXT,
    "canonicalUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "sourceVersion" TEXT,
    "status" "CandidateStatus" NOT NULL DEFAULT 'NEW',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "headline" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "portfolioUrl" TEXT,
    "githubUrl" TEXT,
    "website" TEXT,
    "currentTitle" TEXT,
    "location" TEXT,
    "country" TEXT,
    "city" TEXT,
    "yearsExperience" INTEGER,
    "workAuthorization" TEXT,
    "availability" TEXT,
    "desiredSalary" DECIMAL(65,30),
    "noticePeriod" INTEGER,
    "summary" TEXT,
    "metadata" JSONB,
    "currentOrganizationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "sourceVersion" TEXT,
    "candidateId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "source" "ApplicationSource",
    "coverLetter" TEXT,
    "additionalNotes" TEXT,
    "salaryExpectation" DECIMAL(65,30),
    "noticePeriod" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "sourceVersion" TEXT,
    "name" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillCategory" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "sourceVersion" TEXT,
    "name" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillCategoryAssignment" (
    "skillId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillCategoryAssignment_pkey" PRIMARY KEY ("skillId","categoryId")
);

-- CreateTable
CREATE TABLE "CandidateSkill" (
    "candidateId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "yearsExperience" INTEGER,
    "proficiency" TEXT,
    "verified" BOOLEAN,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateSkill_pkey" PRIMARY KEY ("candidateId","skillId")
);

-- CreateTable
CREATE TABLE "JobSkill" (
    "jobId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "required" BOOLEAN,
    "priority" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobSkill_pkey" PRIMARY KEY ("jobId","skillId")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "sourceVersion" TEXT,
    "candidateId" UUID,
    "jobId" UUID,
    "organizationId" UUID,
    "type" "DocumentType" NOT NULL,
    "storageProvider" TEXT,
    "storageKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "checksum" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isLatest" BOOLEAN DEFAULT true,
    "uploadedBy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_website_key" ON "Organization"("website");

-- CreateIndex
CREATE INDEX "Organization_externalId_idx" ON "Organization"("externalId");

-- CreateIndex
CREATE INDEX "Organization_name_idx" ON "Organization"("name");

-- CreateIndex
CREATE INDEX "Organization_type_idx" ON "Organization"("type");

-- CreateIndex
CREATE INDEX "Contact_email_idx" ON "Contact"("email");

-- CreateIndex
CREATE INDEX "Contact_organizationId_idx" ON "Contact"("organizationId");

-- CreateIndex
CREATE INDEX "Contact_lastName_idx" ON "Contact"("lastName");

-- CreateIndex
CREATE UNIQUE INDEX "Job_slug_key" ON "Job"("slug");

-- CreateIndex
CREATE INDEX "Job_externalId_idx" ON "Job"("externalId");

-- CreateIndex
CREATE INDEX "Job_source_idx" ON "Job"("source");

-- CreateIndex
CREATE INDEX "Job_organizationId_idx" ON "Job"("organizationId");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_employmentType_idx" ON "Job"("employmentType");

-- CreateIndex
CREATE INDEX "Job_workplaceType_idx" ON "Job"("workplaceType");

-- CreateIndex
CREATE INDEX "Job_postedAt_idx" ON "Job"("postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_source_externalId_key" ON "Job"("source", "externalId");

-- CreateIndex
CREATE INDEX "Candidate_email_idx" ON "Candidate"("email");

-- CreateIndex
CREATE INDEX "Candidate_lastName_idx" ON "Candidate"("lastName");

-- CreateIndex
CREATE INDEX "Candidate_currentOrganizationId_idx" ON "Candidate"("currentOrganizationId");

-- CreateIndex
CREATE INDEX "Application_candidateId_idx" ON "Application"("candidateId");

-- CreateIndex
CREATE INDEX "Application_jobId_idx" ON "Application"("jobId");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Application_candidateId_jobId_key" ON "Application"("candidateId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SkillCategory_name_key" ON "SkillCategory"("name");

-- CreateIndex
CREATE INDEX "SkillCategoryAssignment_categoryId_idx" ON "SkillCategoryAssignment"("categoryId");

-- CreateIndex
CREATE INDEX "CandidateSkill_skillId_idx" ON "CandidateSkill"("skillId");

-- CreateIndex
CREATE INDEX "JobSkill_skillId_idx" ON "JobSkill"("skillId");

-- CreateIndex
CREATE INDEX "Document_candidateId_idx" ON "Document"("candidateId");

-- CreateIndex
CREATE INDEX "Document_jobId_idx" ON "Document"("jobId");

-- CreateIndex
CREATE INDEX "Document_organizationId_idx" ON "Document"("organizationId");

-- CreateIndex
CREATE INDEX "Document_type_idx" ON "Document"("type");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_currentOrganizationId_fkey" FOREIGN KEY ("currentOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillCategoryAssignment" ADD CONSTRAINT "SkillCategoryAssignment_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillCategoryAssignment" ADD CONSTRAINT "SkillCategoryAssignment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SkillCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkill" ADD CONSTRAINT "JobSkill_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkill" ADD CONSTRAINT "JobSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
