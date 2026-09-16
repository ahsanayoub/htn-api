import { Router } from "express";
import { randomUUID } from "node:crypto";
import prisma from "../prisma/client.js";
import { AppError } from "../errors/app-error.js";
import { requireRecruiter } from "../middleware/recruiter-auth.js";
import { R2StorageService } from "../services/r2-storage.service.js";

const router = Router();
let storage: R2StorageService | undefined;
function getStorage() { storage ??= new R2StorageService(); return storage; }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
async function accessibleJob(user: any, jobId: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT j.id,j."externalId",j.title,j.status FROM "Job" j WHERE j.id::text=$1 OR COALESCE(j."externalId",'')=$1 LIMIT 1`, jobId);
  if (!rows[0]) return null;
  const ids = user.role === "PLATFORM_ADMIN" ? [rows[0].id] : await prisma.$queryRawUnsafe<{id:string}[]>(`SELECT DISTINCT j.id FROM "Job" j LEFT JOIN recruiter_job_access a ON a.job_id=j.id WHERE (j."organizationId"=$1 OR a.recruiter_id=$2) AND j.id=$3`, user.organizationId, user.id, rows[0].id).then(r=>r.map(x=>x.id));
  return ids.includes(rows[0].id) ? rows[0] : null;
}
router.use(requireRecruiter);
router.post("/", async (req,res)=>{
  try {
    const user=req.recruiter!; const body=req.body??{};
    const job=await accessibleJob(user,text(body.jobId)??"");
    if(!job) throw new AppError("JOB_NOT_FOUND","Job not found",404);
    if(job.status==="CLOSED"||job.status==="ARCHIVED") throw new AppError("JOB_CLOSED","Cannot submit to a closed job",409);
    const firstName=text(body.firstName),lastName=text(body.lastName),email=text(body.email)?.toLowerCase();
    if(!firstName||!lastName||!email) throw new AppError("VALIDATION_ERROR","firstName, lastName, and email are required",400);
    const resume=body.resume&&typeof body.resume==="object"?body.resume:null;
    if(resume){ await getStorage().verifyUploadedResume(String(resume.uploadId),String(resume.storageKey),String(resume.mimeType),Number(resume.size)); }
    const submissionId=randomUUID();
    const result=await prisma.$transaction(async tx=>{
      let candidate=await tx.$queryRawUnsafe<any[]>(`SELECT * FROM "Candidate" WHERE lower(email)=lower($1) AND "organizationId"=(SELECT "organizationId" FROM "Job" WHERE id=$2) AND "deletedAt" IS NULL LIMIT 1`,email,job.id);
      let candidateId=candidate[0]?.id;
      if(candidateId){ await tx.$executeRawUnsafe(`UPDATE "Candidate" SET "firstName"=$1,"lastName"=$2,email=$3,phone=$4,"currentTitle"=$5,location=$6,"yearsExperience"=$7,"updatedAt"=NOW() WHERE id=$8`,firstName,lastName,email,text(body.phone),text(body.currentTitle),text(body.location),typeof body.yearsExperience==="number"?body.yearsExperience:null,candidateId); }
      else { candidateId=randomUUID(); await tx.$executeRawUnsafe(`INSERT INTO "Candidate"(id,"organizationId","firstName","lastName",email,phone,"currentTitle",location,"yearsExperience",source,"engagedAt","createdAt","updatedAt") VALUES($1,(SELECT "organizationId" FROM "Job" WHERE id=$2),$3,$4,$5,$6,$7,$8,$9,'REFERRAL',NOW(),NOW(),NOW())`,candidateId,job.id,firstName,lastName,email,text(body.phone),text(body.currentTitle),text(body.location),typeof body.yearsExperience==="number"?body.yearsExperience:null); }
      const existing=await tx.$queryRawUnsafe<any[]>(`SELECT id FROM "Application" WHERE "candidateId"=$1 AND "jobId"=$2 LIMIT 1`,candidateId,job.id);
      let applicationId=existing[0]?.id;
      if(applicationId){ await tx.$executeRawUnsafe(`UPDATE "Application" SET "submittedAt"=COALESCE("submittedAt",NOW()),source='RECRUITER',"additionalNotes"=$1,"updatedAt"=NOW() WHERE id=$2`,text(body.additionalNotes),applicationId); }
      else { applicationId=randomUUID(); await tx.$executeRawUnsafe(`INSERT INTO "Application"(id,"candidateId","jobId",status,source,"submittedAt","additionalNotes","createdAt","updatedAt",metadata) VALUES($1,$2,$3,'APPLIED','RECRUITER',NOW(),$4,NOW(),NOW(),$5)`,applicationId,candidateId,job.id,text(body.additionalNotes),JSON.stringify({htnSubmissionId:submissionId,recruiterId:user.id})); }
      if(resume){ await tx.$executeRawUnsafe(`UPDATE "Document" SET "isLatest"=FALSE WHERE "candidateId"=$1 AND type='RESUME'`,candidateId); await tx.$executeRawUnsafe(`INSERT INTO "Document"(id,"candidateId",type,"storageProvider","storageKey","fileName","mimeType","size","version","isLatest","createdAt","updatedAt") VALUES($1,$2,'RESUME','CLOUDFLARE_R2',$3,$4,$5,$6,1,TRUE,NOW(),NOW())`,randomUUID(),candidateId,String(resume.storageKey),String(resume.fileName),String(resume.mimeType),Number(resume.size)); }
      return {candidateId,applicationId};
    });
    return res.status(201).json({success:true,data:{...result,submissionId,jobId:job.id,jobExternalId:job.externalId}});
  }catch(e){ if(e instanceof AppError)return res.status(e.statusCode).json({success:false,code:e.code,message:e.message}); console.error("Recruiter submission failed",e); return res.status(500).json({success:false,message:"Unable to submit candidate"}); }
});
export default router;
