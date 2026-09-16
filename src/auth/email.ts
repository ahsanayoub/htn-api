const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_API_ORIGIN = "https://htn-api-production-ab6d.up.railway.app";
const DEFAULT_PORTAL_ORIGIN = "https://headsbaseinc.com/recruiter-portal";

export async function sendRecruiterEmail(input: { to: string; subject: string; html: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== "production") return false;
    throw new Error("Recruiter email is not configured. Set RESEND_API_KEY and AUTH_EMAIL_FROM.");
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html }),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  return true;
}

function portalOrigin(): string {
  const configured = (process.env.RECRUITER_PORTAL_URL ?? DEFAULT_PORTAL_ORIGIN).replace(/\/$/, "");
  if (configured === "https://headsbaseinc.com" || configured === "https://www.headsbaseinc.com") {
    return `${configured}/recruiter-portal`;
  }
  return configured;
}

function apiOrigin(): string {
  return (process.env.RECRUITER_API_URL ?? DEFAULT_API_ORIGIN).replace(/\/$/, "");
}

export function verificationUrl(token: string): string {
  return `${apiOrigin()}/auth/verify-email?token=${encodeURIComponent(token)}`;
}

export function verificationSuccessUrl(): string {
  return `${portalOrigin()}/#/login?verified=1`;
}

export function verificationFailureUrl(): string {
  return `${portalOrigin()}/#/login?verified=0`;
}

export function resetUrl(token: string): string {
  return `${portalOrigin()}/#/reset-password?token=${encodeURIComponent(token)}`;
}
