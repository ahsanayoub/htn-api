import prisma from "../prisma/client.js";
import { AppError } from "../errors/app-error.js";

export type HtnAtsRecruiter = {
  id: string; email: string; firstName: string; lastName: string; name: string;
  organizationId: string; organizationName: string; role: string; emailVerified: boolean;
  status: string; assignedJobCount?: number; submissionCount?: number; assignedAt?: string;
};

export type HtnAtsJobAssignment = HtnAtsRecruiter & {
  jobId: string; jobExternalId: string | null; jobTitle: string;
};

function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function requireKey(): void { if (!process.env.HTN_ATS_INTEGRATION_KEY?.trim()) throw new AppError("INTEGRATION_NOT_CONFIGURED", "ATS integration is not configured", 503); }

async function findJob(atsJobId: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT j.id,j."externalId",j.title,j."organizationId",o.name AS "organizationName" FROM "Job" j JOIN "Organization" o ON o.id=j."organizationId" WHERE j.id::text=$1 OR j."externalId"=$1 LIMIT 1`, atsJobId);
  if (!rows[0]) throw new AppError("JOB_NOT_FOUND", "ATS job not found", 404);
  return rows[0];
}
async function findRecruiter(id: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT ru.id,ru.email,ru.first_name AS "firstName",ru.last_name AS "lastName",ru.organization_id AS "organizationId",o.name AS "organizationName",ru.role,ru.email_verified AS "emailVerified" FROM recruiter_users ru JOIN "Organization" o ON o.id=ru.organization_id WHERE ru.id=$1 LIMIT 1`, id);
  if (!rows[0]) throw new AppError("RECRUITER_NOT_FOUND", "Recruiter not found", 404);
  return rows[0];
}
function mapRecruiter(row:any, extras:Partial<HtnAtsRecruiter>={}):HtnAtsRecruiter { return { id:row.id,email:row.email,firstName:row.firstName,lastName:row.lastName,name:[row.firstName,row.lastName].filter(Boolean).join(" ").trim(),organizationId:row.organizationId,organizationName:row.organizationName,role:row.role,emailVerified:row.emailVerified,status:row.emailVerified?"ACTIVE":"PENDING",...extras }; }

export async function listJobRecruiters(atsJobId:string) {
  requireKey(); const job=await findJob(atsJobId);
  const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT ru.id,ru.email,ru.first_name AS "firstName",ru.last_name AS "lastName",ru.organization_id AS "organizationId",o.name AS "organizationName",ru.role,ru.email_verified AS "emailVerified",a.created_at AS "assignedAt" FROM recruiter_job_access a JOIN recruiter_users ru ON ru.id=a.recruiter_id JOIN "Organization" o ON o.id=ru.organization_id WHERE a.job_id=$1 ORDER BY a.created_at DESC,ru.last_name,ru.first_name`,job.id);
  return { job, recruiters:rows.map(r=>mapRecruiter(r,{assignedAt:r.assignedAt.toISOString()})) };
}
export async function assignJobRecruiter(atsJobId:string,recruiterId:string) {
  requireKey(); const job=await findJob(atsJobId); const recruiter=await findRecruiter(recruiterId);
  const existing=await prisma.$queryRawUnsafe<any[]>(`SELECT created_at AS "createdAt" FROM recruiter_job_access WHERE recruiter_id=$1 AND job_id=$2 LIMIT 1`,recruiter.id,job.id);
  if(existing[0]) throw new AppError("ALREADY_ASSIGNED","Recruiter is already assigned to this job",409);
  const assignedAt=new Date(); await prisma.$executeRawUnsafe(`INSERT INTO recruiter_job_access(recruiter_id,job_id,created_at) VALUES($1,$2,$3)`,recruiter.id,job.id,assignedAt);
  return {job,recruiter:mapRecruiter(recruiter,{assignedAt:assignedAt.toISOString()}),assignedAt:assignedAt.toISOString()};
}
export async function removeJobRecruiter(atsJobId:string,recruiterId:string) {
  requireKey(); const job=await findJob(atsJobId); await findRecruiter(recruiterId);
  const deleted=await prisma.$executeRawUnsafe(`DELETE FROM recruiter_job_access WHERE recruiter_id=$1 AND job_id=$2`,recruiterId,job.id);
  if(deleted===0) throw new AppError("ASSIGNMENT_NOT_FOUND","Recruiter is not assigned to this job",404);
  return {job,recruiterId};
}
export async function listAtsRecruiters(searchInput?:unknown) {
  requireKey(); const search=text(searchInput)??"";
  const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT ru.id,ru.email,ru.first_name AS "firstName",ru.last_name AS "lastName",ru.organization_id AS "organizationId",o.name AS "organizationName",ru.role,ru.email_verified AS "emailVerified",(SELECT COUNT(*)::int FROM recruiter_job_access a WHERE a.recruiter_id=ru.id) AS "assignedJobCount",(SELECT COUNT(*)::int FROM "Application" app WHERE app.source='RECRUITER' AND COALESCE(app.metadata->>'htnRecruiterId','')=ru.id::text) AS "submissionCount" FROM recruiter_users ru JOIN "Organization" o ON o.id=ru.organization_id WHERE ($1='' OR ru.first_name ILIKE '%'||$1||'%' OR ru.last_name ILIKE '%'||$1||'%' OR ru.email ILIKE '%'||$1||'%' OR o.name ILIKE '%'||$1||'%') ORDER BY ru.created_at DESC LIMIT 100`,search);
  return {data:rows.map(r=>mapRecruiter(r,{assignedJobCount:Number(r.assignedJobCount??0),submissionCount:Number(r.submissionCount??0)}))};
}
export async function getAtsRecruiter(recruiterId:string) {
  requireKey(); const recruiter=await findRecruiter(recruiterId);
  const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT j.id AS "jobId",j."externalId" AS "jobExternalId",j.title AS "jobTitle",a.created_at AS "assignedAt" FROM recruiter_job_access a JOIN "Job" j ON j.id=a.job_id WHERE a.recruiter_id=$1 ORDER BY a.created_at DESC,j.title`,recruiter.id);
  const base=mapRecruiter(recruiter,{assignedJobCount:rows.length});
  return {recruiter:base,jobs:rows.map(r=>({...base,jobId:r.jobId,jobExternalId:r.jobExternalId,jobTitle:r.jobTitle,assignedAt:r.assignedAt.toISOString()} as HtnAtsJobAssignment))};
}
export async function recruiterSummaryForJobs(input:unknown) {
  requireKey(); const raw=Array.isArray(input)?input:typeof input==="string"?input.split(","):[];
  const ids=[...new Set(raw.map(text).filter((x):x is string=>Boolean(x)))].slice(0,100);
  if(!ids.length)return {data:[]};
  const jobs=await prisma.$queryRawUnsafe<any[]>(`SELECT id,"externalId" FROM "Job" WHERE id::text=ANY($1::text[]) OR "externalId"=ANY($1::text[])`,ids);
  const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT a.job_id AS "jobId",ru.id,ru.email,ru.first_name AS "firstName",ru.last_name AS "lastName",ru.organization_id AS "organizationId",o.name AS "organizationName",ru.role,ru.email_verified AS "emailVerified" FROM recruiter_job_access a JOIN recruiter_users ru ON ru.id=a.recruiter_id JOIN "Organization" o ON o.id=ru.organization_id WHERE a.job_id=ANY($1::uuid[]) ORDER BY ru.last_name,ru.first_name`,[...new Set(jobs.map(j=>j.id))]);
  return {data:ids.map(atsJobId=>{const job=jobs.find(j=>j.id===atsJobId||j.externalId===atsJobId);const recruiters=job?rows.filter(r=>r.jobId===job.id).map(r=>mapRecruiter(r)):[];return {atsJobId,recruiterCount:recruiters.length,recruiters};})};
}
