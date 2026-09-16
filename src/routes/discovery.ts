import { Router } from "express";
import { AppError } from "../errors/app-error.js";
import { DiscoverySearchService } from "../services/discovery-search.service.js";

const router = Router();
const service = new DiscoverySearchService();

function org(req: any): string {
  const value = req.headers["x-organization-id"];
  if (typeof value !== "string" || !value.trim()) throw new AppError("ORGANIZATION_REQUIRED", "Organization ID is required", 401);
  return value.trim();
}

function sendError(res: any, error: unknown) {
  if (error instanceof AppError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
  console.error("Discovery request failed:", error instanceof Error ? error.message : String(error));
  return res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Internal server error" });
}

router.post("/searches", async (req, res) => { try { const data = await service.create(org(req), req.body ?? {}); return res.status(201).json({ success:true, data }); } catch(e) { return sendError(res,e); } });
router.get("/searches", async (req, res) => { try { const data = await service.list(org(req), req.query); return res.json({ success:true, data }); } catch(e) { return sendError(res,e); } });
router.get("/searches/:searchId", async (req, res) => { try { const data = await service.get(org(req), req.params.searchId); return res.json({ success:true, data }); } catch(e) { return sendError(res,e); } });
router.patch("/searches/:searchId", async (req, res) => { try { const data = await service.update(org(req), req.params.searchId, req.body ?? {}); return res.json({ success:true, data }); } catch(e) { return sendError(res,e); } });
router.post("/searches/:searchId/execute", async (req, res) => { try { const data = await service.execute(org(req), req.params.searchId); return res.status(201).json({ success:true, data }); } catch(e) { return sendError(res,e); } });
router.get("/searches/:searchId/runs", async (req, res) => { try { const data = await service.runs(org(req), req.params.searchId); return res.json({ success:true, data }); } catch(e) { return sendError(res,e); } });
router.get("/runs/:runId/profiles", async (req, res) => { try { const data = await service.profiles(org(req), req.params.runId); return res.json({ success:true, data }); } catch(e) { return sendError(res,e); } });
router.get("/profiles/:profileId", async (req, res) => { try { const data = await service.profile(org(req), req.params.profileId); return res.json({ success:true, data }); } catch(e) { return sendError(res,e); } });
router.patch("/profiles/:profileId", async (req, res) => { try { const data = await service.updateProfile(org(req), req.params.profileId, req.body ?? {}); return res.json({ success:true, data }); } catch(e) { return sendError(res,e); } });

export default router;
