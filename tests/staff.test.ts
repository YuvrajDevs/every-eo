import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execSync } from "node:child_process";

process.env.DATABASE_URL = "file:./staff-test.db";
before(() => {
  fs.rmSync("staff-test.db", { force: true });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
});
after(async () => {
  await (await import("@/lib/db")).db.$disconnect();
  fs.rmSync("staff-test.db", { force: true });
});

test("staff list comes from STAFF_EMAILS, case-insensitive; empty means nobody; email must be verified", async () => {
  const { isStaffEmail: isStaff, isStaff: isStaffUser } = await import("@/lib/staff");
  delete process.env.STAFF_EMAILS;
  assert.equal(isStaff("a@b.co"), false);
  process.env.STAFF_EMAILS = " Ops@Company.com, cs@company.com ,";
  assert.equal(isStaff("ops@company.com"), true);
  assert.equal(isStaff("CS@company.com"), true);
  assert.equal(isStaff("ops@company.com.evil"), false);
  assert.equal(isStaff(""), false);
  assert.equal(isStaffUser({ email: "ops@company.com", emailVerifiedAt: null }), false, "unverified address never gets staff access");
  assert.equal(isStaffUser({ email: "ops@company.com", emailVerifiedAt: new Date() }), true);
  delete process.env.STAFF_EMAILS;
});

test("overview: cost and usage per workspace this month, failures in the last week, attention flags", async () => {
  const { db } = await import("@/lib/db");
  const { workspaceOverview } = await import("@/lib/staff");
  const now = new Date();
  const busy = await db.organization.create({ data: { name: "Busy", plan: "trial" } });
  await db.organization.create({ data: { name: "PaidEmpty", plan: "starter", planStatus: "active" } });
  await db.organization.create({ data: { name: "Late", plan: "starter", planStatus: "past_due" } });
  const d = await db.domain.create({ data: { orgId: busy.id, hostname: "busy.com" } });
  const p = await db.prompt.create({ data: { domainId: d.id, text: "q?" } });
  const run = await db.visibilityRun.create({ data: { orgId: busy.id, domainId: d.id, engines: "chatgpt", status: "completed" } });
  await db.visibilityResult.createMany({ data: Array.from({ length: 280 }, (_, i) => ({ runId: run.id, promptId: p.id, engine: "chatgpt", trial: i })) }); // 280/300 = 93%
  await db.apiCallLog.createMany({ data: [{ orgId: busy.id, provider: "openai", operation: "x", costMicros: 1_250_000 }, { orgId: busy.id, provider: "openai", operation: "x", costMicros: 250_000, createdAt: new Date("2020-01-01") }] });
  await db.job.createMany({ data: [{ orgId: busy.id, type: "crawl", payload: "{}", status: "failed", finishedAt: now }, { orgId: busy.id, type: "crawl", payload: "{}", status: "failed", finishedAt: new Date("2020-01-01") }] });
  const rows = new Map((await workspaceOverview(now)).map((r) => [r.name, r]));
  const b = rows.get("Busy")!;
  assert.equal(b.costMicros, 1_250_000, "last month's cost excluded");
  assert.equal(b.failedJobs7d, 1);
  assert.equal(b.answers, 280);
  assert.deepEqual(b.attention, ["near quota", "failed jobs"]);
  assert.deepEqual(rows.get("PaidEmpty")!.attention, ["paid, no sites"]);
  assert.deepEqual(rows.get("Late")!.attention, ["payment past due"]);
});
