import { Router } from "express";
import { ApplicationService } from "../services/applications.service.js";
import { AppError } from "../errors/app-error.js";
import { ApplicationStatus } from "@prisma/client";
import { requireRecruiter } from "../middleware/recruiter-auth.js";
import { assertApplicationAccess, getAccessibleJobIds } from "../auth/recruiter-auth.js";

const router = Router();
const applicationService = new ApplicationService();
function sendError(res:any,error:unknown){if(error instanceof AppError)return res.status(error.statusCode).json({success:false,code:error.code,message:error.message});console.error("Applications API failed:",error);return res.status(500).json({success:false,message:"Internal server error"});}
function queryString(value:unknown):string|undefined{return typeof value==="string"?value:undefined;}

router.get("/", requireRecruiter, async (req,res)=>{try{const statusValue=queryString(req.query.status);const status=statusValue&&Object.values(ApplicationStatus).includes(statusValue as ApplicationStatus)?statusValue as ApplicationStatus:undefined;const jobId=queryString(req.query.jobId);const search=queryString(req.query.search)?.trim();const pageValue=queryString(req.query.page);const limitValue=queryString(req.query.limit);const ids=await getAccessibleJobIds(req.recruiter!);const result=await applicationService.listApplications({jobId,jobIds:ids,status,search,page:pageValue?Number(pageValue)||1:1,limit:limitValue?Number(limitValue)||20:20});return res.json({success:true,data:result.applications,pagination:result.pagination});}catch(error){return sendError(res,error);}});
router.get("/:applicationId", requireRecruiter, async(req,res)=>{try{const applicationId=queryString(req.params.applicationId);if(!applicationId)throw new AppError("VALIDATION_ERROR","Application id is required",400);await assertApplicationAccess(req.recruiter!,applicationId);const application=await applicationService.getApplicationById(applicationId);if(!application)return res.status(404).json({success:false,code:"APPLICATION_NOT_FOUND",message:"Application not found"});return res.json({success:true,data:application});}catch(error){return sendError(res,error);}});
router.patch("/:applicationId", requireRecruiter, async(req,res)=>{try{const applicationId=queryString(req.params.applicationId);if(!applicationId)throw new AppError("VALIDATION_ERROR","Application id is required",400);await assertApplicationAccess(req.recruiter!,applicationId);const application=await applicationService.updateApplicationStatus(applicationId,req.body?.status);return res.json({success:true,data:application});}catch(error){return sendError(res,error);}});
router.post("/",async(req,res)=>{try{const application=await applicationService.createApplication(req.body??{});return res.status(201).json({success:true,data:application});}catch(error){return sendError(res,error);}});
export default router;
