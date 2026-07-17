import { Router } from "express";
import { getJobById } from "../services/jobs.service.js";

const router = Router();

router.get("/:jobId", async (req, res) => {
    try {
        const job = await getJobById(req.params.jobId);

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found",
            });
        }

        res.json(job);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
});

export default router;