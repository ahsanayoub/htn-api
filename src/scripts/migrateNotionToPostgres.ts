import "dotenv/config";

import { notion } from "../services/notion.js";
import { notionConfig } from "../config/notion.config.js";
import prisma from "../prisma/client.js";
import { OrganizationRepository } from "../repositories/organization.repository.js";
import { JobRepository } from "../repositories/job.repository.js";
import { SkillRepository } from "../repositories/skill.repository.js";
import {
  JobSource,
  EmploymentType,
  WorkplaceType,
  JobStatus,
} from "@prisma/client";

const organizationRepo = new OrganizationRepository();
const jobRepo = new JobRepository();
const skillRepo = new SkillRepository();

const SOURCE_MAP: Record<string, JobSource> = {
  micro1: JobSource.MICRO1,
  greenhouse: JobSource.GREENHOUSE,
  lever: JobSource.LEVER,
  ashby: JobSource.ASHBY,
  workday: JobSource.WORKDAY,
  linkedin: JobSource.LINKEDIN,
  manual: JobSource.MANUAL,
  other: JobSource.OTHER,
};

const STATUS_MAP: Record<string, JobStatus> = {
  Open: JobStatus.ACTIVE,
  Paused: JobStatus.ON_HOLD,
  Filled: JobStatus.CLOSED,
  Archived: JobStatus.ARCHIVED,
  Closed: JobStatus.CLOSED,
};

const EMPLOYMENT_TYPE_MAP: Record<string, EmploymentType> = {
  FULL_TIME: EmploymentType.FULL_TIME,
  PART_TIME: EmploymentType.PART_TIME,
  CONTRACT: EmploymentType.CONTRACT,
  TEMPORARY: EmploymentType.TEMPORARY,
  INTERNSHIP: EmploymentType.INTERNSHIP,
  INTERN: EmploymentType.INTERNSHIP,
  FREELANCE: EmploymentType.FREELANCE,
  VOLUNTEER: EmploymentType.VOLUNTEER,
};

const WORKPLACE_TYPE_MAP: Record<string, { type: WorkplaceType; remote: boolean }> = {
  TELECOMMUTE: { type: WorkplaceType.REMOTE, remote: true },
  Remote: { type: WorkplaceType.REMOTE, remote: true },
  HYBRID: { type: WorkplaceType.HYBRID, remote: true },
  Hybrid: { type: WorkplaceType.HYBRID, remote: true },
  ONSITE: { type: WorkplaceType.ON_SITE, remote: false },
  ON_SITE: { type: WorkplaceType.ON_SITE, remote: false },
  Onsite: { type: WorkplaceType.ON_SITE, remote: false },
  "ON-SITE": { type: WorkplaceType.ON_SITE, remote: false },
};

// ---- Notion property extractors ----

function getRichText(props: Record<string, any>, key: string): string {
  return props[key]?.rich_text?.[0]?.plain_text ?? "";
}

function getTitle(props: Record<string, any>, key: string): string {
  return props[key]?.title?.[0]?.plain_text ?? "";
}

function getSelect(props: Record<string, any>, key: string): string | null {
  return props[key]?.select?.name ?? null;
}

function getDate(props: Record<string, any>, key: string): string | null {
  return props[key]?.date?.start ?? null;
}

function getUrl(props: Record<string, any>, key: string): string | null {
  return props[key]?.url ?? null;
}

function getMultiSelect(props: Record<string, any>, key: string): string[] {
  return props[key]?.multi_select?.map((s: any) => s.name) ?? [];
}

function getStatus(props: Record<string, any>, key: string): string | null {
  return props[key]?.status?.name ?? null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---- Main migration ----

interface MigrationStats {
  totalJobs: number;
  jobsCreated: number;
  jobsUpdated: number;
  orgsCreated: number;
  skillsCreated: number;
  jobSkillsLinked: number;
  errors: { externalId: string; error: string }[];
}

const stats: MigrationStats = {
  totalJobs: 0,
  jobsCreated: 0,
  jobsUpdated: 0,
  orgsCreated: 0,
  skillsCreated: 0,
  jobSkillsLinked: 0,
  errors: [],
};

async function fetchAllNotionJobs(): Promise<any[]> {
  const allJobs: any[] = [];
  let cursor: string | undefined = undefined;
  let hasMore = true;

  while (hasMore) {
    const response = await notion.dataSources.query({
      data_source_id: notionConfig.dataSourceId,
      page_size: 100,
      ...(cursor && { start_cursor: cursor }),
    });

    allJobs.push(...response.results);

    hasMore = response.has_more;
    cursor = response.next_cursor ?? undefined;
  }

  return allJobs;
}

async function runMigration() {
  console.log("Starting migration from Notion to PostgreSQL...\n");

  const notionJobs = await fetchAllNotionJobs();
  console.log(`Fetched ${notionJobs.length} jobs from Notion.\n`);

  const seenOrgs = new Set<string>();

  for (const page of notionJobs) {
    stats.totalJobs++;
    const props = page.properties;

    const externalId = getRichText(props, "Job ID");
    const title = getTitle(props, "Job Title");
    const companyName = getRichText(props, "Company");

    if (!externalId || !title) {
      stats.errors.push({
        externalId: externalId || "<unknown>",
        error: "Missing externalId or title",
      });
      continue;
    }

    if (!companyName) {
      stats.errors.push({ externalId, error: "Missing company name" });
      continue;
    }

    try {
      const source = getSelect(props, "Source");
      const sourceEnum = SOURCE_MAP[source?.toLowerCase() ?? ""] ?? JobSource.OTHER;
      const sourceVersion = page.last_edited_time ?? undefined;

      const employmentTypeStr = getSelect(props, "Employment Type");
      const employmentTypeEnum =
        EMPLOYMENT_TYPE_MAP[employmentTypeStr ?? ""] ?? undefined;

      const locationTypeStr = getSelect(props, "Location Type");
      const wl = locationTypeStr
        ? WORKPLACE_TYPE_MAP[locationTypeStr]
        : undefined;

      const postedDateStr = getDate(props, "Posted Date");
      const postedAt = parseDate(postedDateStr);

      const applyUrl = getUrl(props, "Apply URL");
      const canonicalUrl = getUrl(props, "Source URL");

      const statusStr = getStatus(props, "Status");
      const status = STATUS_MAP[statusStr ?? ""] ?? JobStatus.IMPORTED;

      const responsibilities = getRichText(props, "Responsibilities");
      const requirements = getRichText(props, "Requirements");
      const preferredQualifications = getRichText(props, "Preferred Qualifications");
      const description = getRichText(props, "Job Description");

      const skillNames = getMultiSelect(props, "Required Skills");

      // Track organization creation
      if (!seenOrgs.has(companyName)) {
        const existingOrg = await prisma.organization.findFirst({
          where: { name: companyName },
        });
        if (!existingOrg) {
          stats.orgsCreated++;
        }
        seenOrgs.add(companyName);
      }

      const orgId = await organizationRepo.findOrCreate({
        name: companyName,
      });

      // Track create vs update
      const existingJob = await prisma.job.findFirst({
        where: { source: sourceEnum, externalId },
      });

      await jobRepo.upsert({
        externalId,
        source: sourceEnum,
        sourceVersion,
        title,
        organizationId: orgId,
        description,
        responsibilities,
        requirements,
        preferredQualifications,
        employmentType: employmentTypeEnum ?? null,
        workplaceType: wl?.type ?? null,
        remote: wl?.remote ?? false,
        postedAt,
        applyUrl,
        canonicalUrl,
        status,
        skillNames,
      });

      if (existingJob) {
        stats.jobsUpdated++;
      } else {
        stats.jobsCreated++;
      }

      // Track skills
      if (skillNames.length > 0) {
        for (const skillName of skillNames) {
          const trimmed = skillName.trim();
          if (!trimmed) continue;

          const existingSkill = await prisma.skill.findFirst({
            where: { name: { equals: trimmed, mode: "insensitive" } },
          });
          if (!existingSkill) {
            stats.skillsCreated++;
          }
        }
      }

      stats.jobSkillsLinked += skillNames.filter((s) => s.trim()).length;
    } catch (err: any) {
      stats.errors.push({
        externalId,
        error: err.message ?? String(err),
      });
    }
  }

  printStats();
  await prisma.$disconnect();
}

function printStats() {
  console.log("\n==================== Migration Complete ====================");
  console.log(`Total jobs processed:  ${stats.totalJobs}`);
  console.log(`Jobs created:          ${stats.jobsCreated}`);
  console.log(`Jobs updated:          ${stats.jobsUpdated}`);
  console.log(`Organizations created: ${stats.orgsCreated}`);
  console.log(`Skills created:        ${stats.skillsCreated}`);
  console.log(`JobSkill links added:  ${stats.jobSkillsLinked}`);
  console.log(`Errors:                ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log("\n--- Errors ---");
    for (const err of stats.errors) {
      console.log(`  [${err.externalId}] ${err.error}`);
    }
  }

  console.log("=============================================================\n");
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
