import { Router } from "express";
import { AppError } from "../errors/app-error.js";
import {
  clearSessionCookieHeader,
  ensureRecruiterTables,
  getUserForRequest,
  login,
  logout,
  resetPassword,
  requestPasswordReset,
  sessionCookieHeader,
  signup,
  verifyEmail,
} from "../auth/recruiter-auth.js";
import { resendVerificationEmail } from "../auth/reverification.js";
import { verificationFailureUrl, verificationSuccessUrl } from "../auth/email.js";
import { requireRecruiter } from "../middleware/recruiter-auth.js";

const router = Router();
let tablesReady: Promise<void> | undefined;
function ensureReady() { tablesReady ??= ensureRecruiterTables(); return tablesReady; }
router.use(async (_req, res, next) => {
  try { await ensureReady(); next(); }
  catch (error) { console.error("Unable to initialize recruiter auth tables:", error); res.status(500).json({ success: false, code: "AUTH_STORAGE_UNAVAILABLE", message: "Authentication storage is unavailable" }); }
});

function sendError(res: any, error: unknown) {
  if (error instanceof AppError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
  console.error("Auth API failed:", error);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

router.post("/signup", async (req, res) => {
  try { const result = await signup(req.body ?? {}); res.setHeader("Set-Cookie", sessionCookieHeader(result.token)); return res.status(201).json({ success: true, data: { user: result.user, verificationToken: result.verificationToken } }); }
  catch (error) { return sendError(res, error); }
});

router.post("/login", async (req, res) => {
  try { const result = await login(req.body ?? {}); res.setHeader("Set-Cookie", sessionCookieHeader(result.token)); return res.json({ success: true, data: result.user }); }
  catch (error) { return sendError(res, error); }
});

router.post("/logout", async (req, res) => {
  try { await logout(req); res.setHeader("Set-Cookie", clearSessionCookieHeader()); return res.json({ success: true }); }
  catch (error) { return sendError(res, error); }
});

router.get("/me", async (req, res) => {
  try { return res.json({ success: true, data: await getUserForRequest(req) }); }
  catch (error) { return sendError(res, error); }
});

router.get("/verify-email", async (req, res) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    await verifyEmail(token);
    return res.redirect(302, verificationSuccessUrl());
  } catch (error) {
    console.error("Email verification failed:", error);
    return res.redirect(302, verificationFailureUrl());
  }
});

router.post("/verify-email", async (req, res) => {
  try { return res.json({ success: true, data: await verifyEmail(typeof req.body?.token === "string" ? req.body.token : "") }); }
  catch (error) { return sendError(res, error); }
});

router.post("/resend-verification", async (req, res) => {
  try { await resendVerificationEmail(typeof req.body?.email === "string" ? req.body.email : ""); return res.json({ success: true }); }
  catch (error) { return sendError(res, error); }
});

router.post("/forgot-password", async (req, res) => {
  try { const result = await requestPasswordReset(req.body?.email); return res.json({ success: true, data: { resetToken: result.resetToken } }); }
  catch (error) { return sendError(res, error); }
});

router.post("/reset-password", async (req, res) => {
  try { await resetPassword(typeof req.body?.token === "string" ? req.body.token : "", req.body?.password); return res.json({ success: true }); }
  catch (error) { return sendError(res, error); }
});

router.get("/session", requireRecruiter, (req, res) => res.json({ success: true, data: req.recruiter }));

export default router;
