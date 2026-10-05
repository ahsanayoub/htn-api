import { Router } from "express";
import { randomUUID } from "node:crypto";
import prisma from "../prisma/client.js";
import { AppError } from "../errors/app-error.js";
import { ApplicationService } from "../services/applications.service.js";

const router = Router();
const applicationService = new ApplicationService();

function requireIntegrationKey(req: { headers: Record<string, unknown> }) {
  const expected = process.env.HTN_ATS_INTEGRATION_KEY;
  if (!expected) throw new AppError("INTEGRATION_NOT_CONFIGURED", "ATS integration is not configured", 503);
  const supplied = typeof req.headers.authorization === "string"
    ? req.headers.authorization.replace(/^Bearer\s+/i, "").trim()
    : "";
  if (!supplied || supplied !== expected) {
    throw new AppError("UNAUTHORIZED", "Invalid integration credentials", 401);
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapJobStatus(value: unknown): "ACTIVE" | "ON_HOLD" | "CLOSED" {
  if (value === "ON_HOLD") return "ON_HOLD";
  if (value === "CLOSED" || value === "FILLED") return "CLOSED";
  return "ACTIVE";
}

function sendError(res: any, error: unknown) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
  }
  console.error("ATS integration failed:", error);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

/**
 * ATS → HTN application status sync.
 * htnSubmissionId is the HTN Application.id established by outbound submission sync.
 * Does not trigger HTN → ATS submission synchronization.
 */
router.put("/submissions/:htnSubmissionId", async (req, res) => {
  try {
    requireIntegrationKey(req);

    const htnSubmissionId = text(req.params.htnSubmissionId);
    if (!htnSubmissionId) {
      throw new AppError("VALIDATION_ERROR", "htnSubmissionId is required", 400);
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.atsApplicationId !== undefined && typeof body.atsApplicationId !== "string") {
      throw new AppError("VALIDATION_ERROR", "atsApplicationId must be a string when provided", 400);
    }
    if (body.atsStage !== undefined && typeof body.atsStage !== "string") {
      throw new AppError("VALIDATION_ERROR", "atsStage must be a string when provided", 400);
    }
    if (body.changedAt !== undefined) {
      if (typeof body.changedAt !== "string" || !isoDate(body.changedAt)) {
        throw new AppError("VALIDATION_ERROR", "changedAt must be a valid ISO-8601 timestamp when provided", 400);
      }
    }

    const application = await applicationService.updateApplicationStatus(
      htnSubmissionId,
      body.status,
    );

    return res.status(200).json({
      success: true,
      data: {
        id: application.id,
        status: application.status,
        candidateId: application.candidateId,
        jobId: application.jobId,
        source: application.source,
        atsApplicationId: text(body.atsApplicationId),
        atsStage: text(body.atsStage),
        changedAt: text(body.changedAt),
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

type ExistingAtsJob = { id: string; source: string };

/**
 * Resolve which HTN Job row an ATS upsert may touch.
 *
 * - OTHER + externalId → update that row
 * - MANUAL + externalId only → refuse (no silent duplicate OTHER row)
 * - neither → create OTHER + INTERNAL
 */
async function resolveAtsJobTarget(atsJobId: string): Promise<
  | { action: "update"; jobId: string }
  | { action: "create" }
> {
  const other = await prisma.$queryRawUnsafe<ExistingAtsJob[]>(
    `SELECT id, source::text AS source FROM "Job" WHERE source = 'OTHER' AND "externalId" = $1 LIMIT 1`,
    atsJobId,
  );
  if (other[0]) {
    return { action: "update", jobId: other[0].id };
  }

  const manual = await prisma.$queryRawUnsafe<ExistingAtsJob[]>(
    `SELECT id, source::text AS source FROM "Job" WHERE source = 'MANUAL' AND "externalId" = $1 LIMIT 1`,
    atsJobId,
  );
  if (manual[0]) {
    throw new AppError(
      "ATS_JOB_SOURCE_COLLISION",
      "An existing MANUAL job already owns this ATS externalId; refusing to create a duplicate OTHER row. Controlled remapping is required before ATS sync can update this job.",
      409,
    );
  }

  return { action: "create" };
}

/**
 * Upsert an ATS job into HTN.
 * ATS remains the source of truth; HTN stores an external projection used by recruiters.
 *
 * New / OTHER rows: source=OTHER, visibility=INTERNAL.
 * Does not create OTHER duplicates for existing MANUAL+same externalId rows.
 */
router.put("/jobs/:atsJobId", async (req, res) => {
  try {
    requireIntegrationKey(req);

    const atsJobId = text(req.params.atsJobId);
    if (!atsJobId) throw new AppError("VALIDATION_ERROR", "ATS job id is required", 400);

    const body = req.body ?? {};
    const organization = body.organization ?? {};
    const organizationExternalId = text(organization.id);
    const organizationName = text(organization.name);
    if (!organizationExternalId || !organizationName) {
      throw new AppError("VALIDATION_ERROR", "organization.id and organization.name are required", 400);
    }

    const title = text(body.title);
    if (!title) throw new AppError("VALIDATION_ERROR", "title is required", 400);

    const organizationRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "Organization" WHERE "externalId"=$1 LIMIT 1`,
      organizationExternalId,
    );
    const organizationId = organizationRows[0]?.id ?? randomUUID();

    if (!organizationRows[0]) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Organization"(id,"externalId",type,name,"createdAt","updatedAt") VALUES($1,$2,'COMPANY',$3,NOW(),NOW())`,
        organizationId,
        organizationExternalId,
        organizationName,
      );
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE "Organization" SET name=$1,"updatedAt"=NOW() WHERE id=$2`,
        organizationName,
        organizationId,
      );
    }

    const bodyMetadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : {};

    const requirements = body.requirements ?? bodyMetadata.atsRequirements ?? null;
    const metadata = {
      ...bodyMetadata,
      origin: "ats",
      integration: "HTN_ATS",
      atsJobId,
      atsOrganizationId: organizationExternalId,
      atsClientId:
        bodyMetadata.atsClientId === undefined ? null : bodyMetadata.atsClientId,
      syncedAt: new Date().toISOString(),
      atsRequirements: bodyMetadata.atsRequirements ?? requirements,
    };

    const target = await resolveAtsJobTarget(atsJobId);
    const jobId = target.action === "update" ? target.jobId : randomUUID();

    const fieldValues = [
      organizationId,
      title,
      text(body.summary),
      text(body.description),
      text(body.descriptionHtml),
      text(body.responsibilities),
      requirements,
      text(body.preferredQualifications),
      text(body.employmentType),
      text(body.workplaceType),
      text(body.department),
      text(body.seniority),
      numberValue(body.experienceMin),
      numberValue(body.experienceMax),
      numberValue(body.salaryMin),
      numberValue(body.salaryMax),
      text(body.salaryCurrency),
      text(body.location),
      text(body.country),
      text(body.city),
      booleanValue(body.remote),
      numberValue(body.openings) ?? 1,
      isoDate(body.postedAt),
      isoDate(body.expiresAt),
      mapJobStatus(body.status),
      text(body.applyUrl),
      text(body.canonicalUrl),
      JSON.stringify(metadata),
    ] as const;

    if (target.action === "update") {
      await prisma.$executeRawUnsafe(
        `UPDATE "Job" SET
          "organizationId"=$1,title=$2,summary=$3,description=$4,"descriptionHtml"=$5,
          responsibilities=$6,requirements=$7,"preferredQualifications"=$8,
          "employmentType"=$9,"workplaceType"=$10,department=$11,seniority=$12,
          "experienceMin"=$13,"experienceMax"=$14,"salaryMin"=$15,"salaryMax"=$16,"salaryCurrency"=$17,
          location=$18,country=$19,city=$20,remote=$21,openings=$22,"postedAt"=$23,"expiresAt"=$24,
          status=$25,"applyUrl"=$26,"canonicalUrl"=$27,metadata=$28,
          visibility='INTERNAL',"lastSyncedAt"=NOW(),"lastSeenAt"=NOW(),"updatedAt"=NOW()
        WHERE id=$29 AND source='OTHER'`,
        ...fieldValues,
        jobId,
      );
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Job"(
          id,"externalId","source","organizationId",title,summary,description,"descriptionHtml",
          responsibilities,requirements,"preferredQualifications","employmentType","workplaceType",
          department,seniority,"experienceMin","experienceMax","salaryMin","salaryMax","salaryCurrency",
          location,country,city,remote,openings,"postedAt","expiresAt",status,"applyUrl","canonicalUrl",
          metadata,visibility,"lastSyncedAt","lastSeenAt","createdAt","updatedAt"
        ) VALUES (
          $1,$2,'OTHER',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
          'INTERNAL',NOW(),NOW(),NOW(),NOW()
        )`,
        jobId,
        atsJobId,
        ...fieldValues,
      );
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT j.id,j."externalId",j.source::text AS source,j.visibility::text AS visibility,j.title,j.status,
              j."organizationId",o.name AS "organizationName",j."lastSyncedAt",j."lastSeenAt"
       FROM "Job" j
       JOIN "Organization" o ON o.id=j."organizationId"
       WHERE j.id=$1
       LIMIT 1`,
      jobId,
    );

    return res.json({ success: true, data: rows[0] ?? null });
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
