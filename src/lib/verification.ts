import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mailer";

const TTL_MS = 24 * 60 * 60_000;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function sendVerificationEmail(user: { id: string; email: string; name: string }, baseUrl: string) {
  const token = randomBytes(32).toString("base64url");
  await db.emailToken.create({ data: { userId: user.id, purpose: "verify_email", hash: hash(token), expiresAt: new Date(Date.now() + TTL_MS) } });
  const link = `${baseUrl}/verify?token=${token}`;
  await sendMail({
    to: user.email,
    subject: "Confirm your email address",
    text: `Hi ${user.name},\n\nConfirm your email address by opening this link within 24 hours:\n${link}\n\nIf you didn't create an account, ignore this email.`,
  });
  return link;
}

// Single use, expires after 24 hours. Returns the verified user's id, or null.
export async function consumeVerificationToken(token: string) {
  if (!token || token.length > 200) return null;
  const row = await db.emailToken.findUnique({ where: { hash: hash(token) } });
  if (!row || row.purpose !== "verify_email" || row.usedAt || row.expiresAt < new Date()) return null;
  const used = await db.emailToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) return null; // consumed concurrently
  await db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
  return row.userId;
}
