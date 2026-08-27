import { Router } from "express";
import { AppError } from "../errors/app-error.js";
import { R2StorageService } from "../services/r2-storage.service.js";

const router = Router();
let storage: R2StorageService | undefined;

function getStorage(): R2StorageService {
  storage ??= new R2StorageService();
  return storage;
}

router.post("/upload-url", (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
    const size = typeof body.size === "number" ? body.size : Number(body.size);

    if (!fileName || !mimeType || !Number.isFinite(size)) {
      throw new AppError("VALIDATION_ERROR", "fileName, mimeType, and size are required", 400);
    }

    const upload = getStorage().createResumeUploadUrl({ fileName, mimeType, size });
    return res.status(201).json({ success: true, data: upload });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    }

    const message = error instanceof Error ? error.message : String(error);
    const statusCode = message.startsWith("Unsupported resume") || message.startsWith("Resume must") ? 400 : 500;
    return res.status(statusCode).json({
      success: false,
      code: statusCode === 400 ? "VALIDATION_ERROR" : "INTERNAL_ERROR",
      message: statusCode === 400 ? message : "Unable to create resume upload URL",
    });
  }
});

export default router;
