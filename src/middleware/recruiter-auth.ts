import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { ensureRecruiterTables, getUserForRequest, type RecruiterUser } from "../auth/recruiter-auth.js";

let tablesReady: Promise<void> | undefined;

async function ensureReady(): Promise<void> {
  tablesReady ??= ensureRecruiterTables();
  return tablesReady;
}

declare global {
  namespace Express {
    interface Request {
      recruiter?: RecruiterUser;
    }
  }
}

export async function requireRecruiter(req: Request, res: Response, next: NextFunction) {
  try {
    await ensureReady();
    req.recruiter = await getUserForRequest(req);
    next();
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    }
    console.error("Recruiter authentication failed:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function prepareRecruiterAuth(): Promise<void> {
  await ensureReady();
}
