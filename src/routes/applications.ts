import { Router } from "express";
import { ApplicationService } from "../services/applications.service.js";
import { AppError } from "../errors/app-error.js";

const router = Router();

const applicationService = new ApplicationService();

router.post("/", async (req, res) => {
  try {
    const application = await applicationService.createApplication(
      req.body ?? {},
    );

    return res.status(201).json({
      success: true,
      data: application,
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
    console.error("Application submission failed:", errorMessage);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

export default router;
