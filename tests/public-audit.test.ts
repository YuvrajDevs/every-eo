import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execSync } from "node:child_process";

process.env.DATABASE_URL = "file:./public-audit-test.db";

before(() => {
  fs.rmSync("public-audit-test.db", { force: true });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
});
after(async () => {
  await (await import("@/lib/db")).db.$disconnect();
  fs.rmSync("public-audit-test.db", { force: true });
});

test("free audits live in one hidden workspace with no members and a smaller page limit", async () => {
  const { createPublicAudit, PUBLIC_MAX_PAGES } = await import("@/lib/public-audit");
  const { db } = await import("@/lib/db");
  const a = await createPublicAudit("one.example", null, "203.0.113.1");
  const b = await createPublicAudit("two.example", null, "203.0.113.2");
  const orgs = await db.organization.findMany({ where: { kind: "public" }, include: { _count: { select: { memberships: true } } } });
  assert.equal(orgs.length, 1);
  assert.equal(orgs[0]._count.memberships, 0, "nobody can log into the public workspace");
  const crawl = await db.crawl.findUniqueOrThrow({ where: { id: a.crawlId } });
  assert.equal(crawl.maxPages, PUBLIC_MAX_PAGES);
  assert.equal(crawl.orgId, orgs[0].id);
  assert.notEqual(a.crawlId, b.crawlId);
  assert.equal(await db.job.count({ where: { type: "crawl" } }), 2);
  assert.notEqual(a.ipKey, "203.0.113.1", "visitor IPs are stored hashed");
});

test("an active or day-old completed audit of the same site is reused; an older one isn't", async () => {
  const { createPublicAudit } = await import("@/lib/public-audit");
  const { db } = await import("@/lib/db");
  const first = await createPublicAudit("reuse.example", null, "203.0.113.3");
  const whileRunning = await createPublicAudit("reuse.example", null, "203.0.113.4");
  assert.equal(whileRunning.crawlId, first.crawlId);
  await db.crawl.update({ where: { id: first.crawlId }, data: { status: "completed", createdAt: new Date(Date.now() - 2 * 60 * 60_000) } });
  assert.equal((await createPublicAudit("reuse.example", null, "203.0.113.5")).crawlId, first.crawlId);
  await db.crawl.update({ where: { id: first.crawlId }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60_000) } });
  assert.notEqual((await createPublicAudit("reuse.example", null, "203.0.113.6")).crawlId, first.crawlId);
});

test("AI check: skipped without a Gemini key, queued with one, and capped per day", async () => {
  const { createPublicAudit } = await import("@/lib/public-audit");
  const { db } = await import("@/lib/db");
  const saved = { key: process.env.GEMINI_API_KEY, limit: process.env.PUBLIC_AI_DAILY_LIMIT };
  try {
    process.env.GEMINI_API_KEY = "";
    const noKey = await createPublicAudit("ai.example", "best widgets online", "203.0.113.7");
    assert.equal(noKey.aiStatus, "skipped");
    assert.equal(await db.job.count({ where: { type: "publicAi" } }), 0);

    process.env.GEMINI_API_KEY = "test-key";
    process.env.PUBLIC_AI_DAILY_LIMIT = "2";
    const one = await createPublicAudit("ai.example", "best widgets online", "203.0.113.8");
    const two = await createPublicAudit("ai.example", "best widgets online", "203.0.113.9");
    const three = await createPublicAudit("ai.example", "best widgets online", "203.0.113.10");
    assert.equal(one.aiStatus, "queued");
    assert.equal(two.aiStatus, "queued");
    assert.equal(three.aiStatus, "skipped", "daily cap reached");
    assert.match(JSON.parse(three.aiResult!).reason, /used up/);
    assert.equal(await db.job.count({ where: { type: "publicAi" } }), 2);

    const noQuestion = await createPublicAudit("ai.example", null, "203.0.113.11");
    assert.equal(noQuestion.aiStatus, "none");
  } finally {
    process.env.GEMINI_API_KEY = saved.key;
    process.env.PUBLIC_AI_DAILY_LIMIT = saved.limit;
  }
});
