import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";

import jobsRouter from "./routes/jobs.js";
import applicationsRouter from "./routes/applications.js";
import resumesRouter from "./routes/resumes.js";
import candidatesRouter from "./routes/candidates.js";
import discoveryRouter from "./routes/discovery.js";
import authRouter from "./routes/auth.js";
import recruiterRouter from "./routes/recruiter.js";
import recruiterSubmissionsRouter from "./routes/recruiter-submissions.js";
import atsIntegrationRouter from "./routes/integrations-ats.js";
import atsRecruiterIntegrationRouter from "./routes/integrations-ats-recruiters.js";
import { prepareRecruiterAuth } from "./middleware/recruiter-auth.js";
import { AppError } from "./errors/app-error.js";

const app = express();

const configuredOrigins = (process.env.RECRUITER_ALLOWED_ORIGINS ?? "https://headsbaseinc.com,https://www.headsbaseinc.com")
  .split(",").map(value => value.trim()).filter(Boolean);
if (process.env.NODE_ENV !== "production") {
  configuredOrigins.push("http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000", "http://127.0.0.1:5173");
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || configuredOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed"));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "Authorization"],
}));

app.use(express.json({ limit: "20mb" }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const protectedRoute = req.path.startsWith("/auth") || req.path.startsWith("/recruiter");
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  if (protectedRoute && mutating && origin && !configuredOrigins.includes(origin)) {
    return res.status(403).json({ success: false, code: "ORIGIN_NOT_ALLOWED", message: "Origin not allowed" });
  }
  next();
});

app.use("/auth", authRouter);
app.use("/recruiter", recruiterRouter);
app.use("/recruiter/submissions", recruiterSubmissionsRouter);
app.use("/integrations/ats", atsIntegrationRouter);
app.use("/integrations/ats", atsRecruiterIntegrationRouter);

app.use("/api/jobs", jobsRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/resumes", resumesRouter);
app.use("/api/candidates", candidatesRouter);
app.use("/api/discovery", discoveryRouter);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof AppError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
  console.error("Unhandled API error:", error);
  return res.status(500).json({ success: false, message: "Internal server error" });
});

export { prepareRecruiterAuth };
export default app;
