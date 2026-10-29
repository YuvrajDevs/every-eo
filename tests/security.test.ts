import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { clientIpFrom } from "@/lib/client-ip";

process.env.DATABASE_URL = "file:./security-test.db";
before(() => {
  fs.rmSync("security-test.db", { force: true });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
});
after(async () => {
  await (await import("@/lib/db")).db.$disconnect();
  fs.rmSync("security-test.db", { force: true });
});

test("client IP: forged left-hand X-Forwarded-For entries are ignored; hops configurable; 0 ignores headers", () => {
  const h = (xff: string, real?: string) => new Headers({ "x-forwarded-for": xff, ...(real ? { "x-real-ip": real } : {}) });
  delete process.env.TRUST_PROXY_HOPS;
  assert.equal(clientIpFrom(h("6.6.6.6, 203.0.113.9")), "203.0.113.9", "attacker-supplied 6.6.6.6 is not trusted");
  process.env.TRUST_PROXY_HOPS = "2";
  assert.equal(clientIpFrom(h("6.6.6.6, 203.0.113.9, 10.0.0.2")), "203.0.113.9");
  process.env.TRUST_PROXY_HOPS = "0";
  assert.equal(clientIpFrom(h("203.0.113.9")), "direct");
  process.env.TRUST_PROXY_HOPS = "1";
  assert.equal(clientIpFrom(new Headers()), "unknown");
  assert.equal(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
  delete process.env.TRUST_PROXY_HOPS;
});

test("sessions: active until revoked or expired; tied to their user; revoke-all ends every device", async () => {
  const { db } = await import("@/lib/db");
  const { openSession, isSessionActive, revokeSession, revokeAllSessions } = await import("@/lib/session-store");
  const u = await db.user.create({ data: { email: "s@a.co", name: "S", passwordHash: "x" } });
  const other = await db.user.create({ data: { email: "o@a.co", name: "O", passwordHash: "x" } });
  const a = await openSession(u.id);
  const b = await openSession(u.id);
  assert.equal(await isSessionActive(a.id, u.id), true);
  assert.equal(await isSessionActive(a.id, other.id), false, "a session id can't be used with another user's id");
  assert.equal(await isSessionActive("nope", u.id), false);
  await revokeSession(a.id);
  assert.equal(await isSessionActive(a.id, u.id), false);
  assert.equal(await isSessionActive(b.id, u.id), true);
  assert.equal(await isSessionActive(b.id, u.id, new Date(Date.now() + 8 * 86_400_000)), false, "expires after 7 days");
  await revokeAllSessions(u.id);
  assert.equal(await isSessionActive(b.id, u.id), false);
});

test("email verification: link works once, expires, and unknown tokens fail; only a hash is stored", async () => {
  const { db } = await import("@/lib/db");
  const { sendVerificationEmail, consumeVerificationToken } = await import("@/lib/verification");
  const u = await db.user.create({ data: { email: "v@a.co", name: "V", passwordHash: "x" } });
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => logs.push(a.join(" "));
  try {
    const link = await sendVerificationEmail(u, "https://app.example");
    const token = new URL(link).searchParams.get("token")!;
    assert.ok(logs.some((l) => l.includes(link)), "without SMTP the link is logged for development");
    assert.equal(await db.emailToken.count({ where: { hash: token } }), 0, "raw token not stored");
    assert.equal(await consumeVerificationToken("garbage"), null);
    assert.equal(await consumeVerificationToken(token), u.id);
    assert.ok((await db.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt);
    assert.equal(await consumeVerificationToken(token), null, "single use");
    const link2 = await sendVerificationEmail(u, "https://app.example");
    await db.emailToken.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await consumeVerificationToken(new URL(link2).searchParams.get("token")!), null, "expired");
    assert.equal(await consumeVerificationToken("x".repeat(500)), null);
  } finally {
    console.log = orig;
  }
});

test("mail headers can't be injected through names or subjects (real SMTP round trip)", async () => {
  const { startSmtpSink } = await import("./helpers/smtp-sink");
  const sink = await startSmtpSink(2526);
  const { sendMail, resetMailer } = await import("@/lib/mailer");
  process.env.SMTP_URL = "smtp://127.0.0.1:2526?ignoreTLS=true";
  process.env.MAIL_FROM = "reports@app.example";
  resetMailer();
  try {
    await sendMail({ to: "a@b.co", subject: "Hi\r\nBcc: victim@x.com", text: "body", fromName: 'Evil"\r\nBcc: x@y.z <a>' });
    assert.equal(sink.messages.length, 1);
    assert.deepEqual(sink.messages[0].to, ["a@b.co"], "no extra recipients smuggled in");
    const headers = sink.messages[0].raw.split(/\r?\n\r?\n/)[0];
    assert.ok(!/^bcc:/im.test(headers), headers);
    assert.match(headers, /^Subject: Hi Bcc: victim@x.com$/m);
  } finally {
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    resetMailer();
    await sink.close();
  }
});
