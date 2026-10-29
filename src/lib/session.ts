import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { SESSION_DAYS, isSessionActive, openSession, revokeSession } from "@/lib/session-store";

const COOKIE = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * SESSION_DAYS;

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(secret);
}

export type Session = { userId: string; orgId: string; sid: string };

// The cookie is a signed JWT that also names a server-side session row; revoking the row ends the session at once.
// sid: reuse the current session (e.g. when switching workspace) instead of opening a new one.
export async function createSession(session: { userId: string; orgId: string }, sid?: string) {
  const id = sid ?? (await openSession(session.userId)).id;
  const token = await new SignJWT({ ...session, sid: id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key());
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.userId !== "string" || typeof payload.orgId !== "string" || typeof payload.sid !== "string") return null;
    if (!(await isSessionActive(payload.sid, payload.userId))) return null;
    return { userId: payload.userId, orgId: payload.orgId, sid: payload.sid };
  } catch {
    return null;
  }
}

export async function destroySession() {
  const current = await readSession();
  if (current) await revokeSession(current.sid);
  (await cookies()).delete(COOKIE);
}
