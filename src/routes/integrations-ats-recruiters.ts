import { Router } from "express";
import { AppError } from "../errors/app-error.js";
import { assignJobRecruiter, getAtsRecruiter, listAtsRecruiters, listJobRecruiters, removeJobRecruiter, recruiterSummaryForJobs } from "../services/htn-ats-recruiter.service.js";

const router=Router();
function requireKey(req:any){const expected=process.env.HTN_ATS_INTEGRATION_KEY?.trim();const supplied=typeof req.headers.authorization==="string"?req.headers.authorization.replace(/^Bearer\s+/i,"").trim():"";if(!expected)throw new AppError("INTEGRATION_NOT_CONFIGURED","ATS integration is not configured",503);if(!supplied||supplied!==expected)throw new AppError("UNAUTHORIZED","Invalid integration credentials",401);}
function error(res:any,e:unknown){if(e instanceof AppError)return res.status(e.statusCode).json({success:false,code:e.code,message:e.message});console.error("HTN ATS recruiter integration failed:",e);return res.status(500).json({success:false,message:"Internal server error"});}
router.get("/jobs/:atsJobId/recruiters",async(req,res)=>{try{requireKey(req);return res.json({success:true,data:await listJobRecruiters(req.params.atsJobId)});}catch(e){return error(res,e);}});
router.post("/jobs/:atsJobId/recruiters/:recruiterId",async(req,res)=>{try{requireKey(req);return res.status(201).json({success:true,data:await assignJobRecruiter(req.params.atsJobId,req.params.recruiterId)});}catch(e){return error(res,e);}});
router.delete("/jobs/:atsJobId/recruiters/:recruiterId",async(req,res)=>{try{requireKey(req);return res.json({success:true,data:await removeJobRecruiter(req.params.atsJobId,req.params.recruiterId)});}catch(e){return error(res,e);}});
router.get("/recruiters",async(req,res)=>{try{requireKey(req);return res.json({success:true,...await listAtsRecruiters(req.query.search)});}catch(e){return error(res,e);}});
router.get("/recruiters/:recruiterId",async(req,res)=>{try{requireKey(req);return res.json({success:true,data:await getAtsRecruiter(req.params.recruiterId)});}catch(e){return error(res,e);}});
router.get("/jobs/recruiter-summary",async(req,res)=>{try{requireKey(req);return res.json({success:true,...await recruiterSummaryForJobs(req.query.atsJobIds)});}catch(e){return error(res,e);}});
export default router;
