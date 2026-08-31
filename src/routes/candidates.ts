import { Router } from "express";

import { CandidateService } from "../services/candidate.service.js";
import { AppError } from "../errors/app-error.js";

const router = Router();

const candidateService = new CandidateService();

router.post("/talent-network", async (req, res) => {
  try {
    const result = await candidateService.joinTalentNetwork(req.body ?? {});

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof AppError) {
      const statusCode =
        error.code === "VALIDATION_ERROR" ? 400 : error.statusCode;

      return res.status(statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error("Talent network submission failed:", errorMessage);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

export default router;
