import { db } from "@/lib/db";

export const SESSION_DAYS = 7;

export async function openSession(userId: string) {
  return db.session.create({ data: { userId, expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) } });
}

export async function isSessionActive(sid: string, userId: string, now = new Date()) {
  const s = await db.session.findUnique({ where: { id: sid } });
  return Boolean(s && s.userId === userId && !s.revokedAt && s.expiresAt > now);
}

export async function revokeSession(sid: string) {
  await db.session.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string) {
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
