import { Router } from "express";
import { getJobs, getJobById } from "../services/jobs.service.js";
import type { JobFilters } from "../services/jobs.service.js";

const router = Router();

/**
 * GET /api/jobs
 * Supports page-based pagination and filtering
 *
 * Examples:
 * /api/jobs
 * /api/jobs?page=2
 * /api/jobs?page=2&limit=20
 * /api/jobs?search=validation
 * /api/jobs?company=Pfizer
 */


router.get("/", async (req, res) => {
    try {
        const limit = Math.min(
            Math.max(Number(req.query.limit) || 20, 1),
            100
        );
        
        const page = Math.max(Number(req.query.page) || 1, 1);
        
                const filters: JobFilters = {
                    source:
                        typeof req.query.source === "string"
                            ? req.query.source
                            : undefined,
                
                    company:
                        typeof req.query.company === "string"
                            ? req.query.company
                            : undefined,
                
                    employmentType:
                        typeof req.query.employmentType === "string"
                            ? req.query.employmentType
                            : undefined,
                
                    locationType:
                        typeof req.query.locationType === "string"
                            ? req.query.locationType
                            : undefined,
                
                    remote:
                        typeof req.query.remote === "string"
                            ? req.query.remote === "true"
                            : undefined,
                
                    search:
                        typeof req.query.search === "string"
                            ? req.query.search.trim()
                            : undefined,

                    posted:
                            typeof req.query.posted === "string"
                                ? Number(req.query.posted)
                                : undefined,
                        
                     sort:
                            req.query.sort === "oldest"
                                ? "oldest"
                                : "newest",
                };
                
                const result = await getJobs(filters, page, limit);

        res.status(200).json({
            success: true,
            data: result.jobs,
            pagination: result.pagination,
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
});

/**
 * GET /api/jobs/:jobId
 */
router.get("/:jobId", async (req, res) => {
    try {
        const { jobId } = req.params;

        const job = await getJobById(jobId);

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found",
            });
        }

        res.status(200).json({
            success: true,
            data: job,
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
});

export default router;