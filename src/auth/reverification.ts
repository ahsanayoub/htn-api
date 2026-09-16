import { randomBytes, randomUUID, createHash } from "node:crypto";
import prisma from "../prisma/client.js";
import { AppError } from "../errors/app-error.js";
import { sendRecruiterEmail, verificationUrl } from "./email.js";

function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }

export async function resendVerificationEmail(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new AppError("VALIDATION_ERROR", "Invalid email address", 400);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; firstName: string; email: string; emailVerified: boolean }>>(
    `SELECT id, first_name AS "firstName", email, email_verified AS "emailVerified" FROM recruiter_users WHERE email=$1 LIMIT 1`, normalized,
  );
  const user = rows[0];
  if (!user || user.emailVerified) return;
  const token = randomBytes(32).toString("hex");
  await prisma.$executeRawUnsafe(`UPDATE recruiter_email_tokens SET used_at=NOW() WHERE recruiter_id=$1 AND kind='VERIFY' AND used_at IS NULL`, user.id);
  await prisma.$executeRawUnsafe(`INSERT INTO recruiter_email_tokens(id,recruiter_id,token_hash,kind,expires_at) VALUES($1,$2,$3,'VERIFY',NOW()+INTERVAL '24 hours')`, randomUUID(), user.id, hashToken(token));
  await sendRecruiterEmail({
    to: user.email,
    subject: "Verify your Headsbase recruiter account",
    html: `<p>Hello ${user.firstName},</p><p>Verify your recruiter account:</p><p><a href="${verificationUrl(token)}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  });
}
