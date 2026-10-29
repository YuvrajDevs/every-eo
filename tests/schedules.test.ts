import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.DATABASE_URL = "file:./sched-test.db";

before(() => {
  fs.rmSync("sched-test.db", { force: true });
  require("node:child_process").execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
});
after(async () => {
  await (await import("@/lib/db")).db.$disconnect();
  fs.rmSync("sched-test.db", { force: true });
});

async function setup(extra: Record<string, unknown> = {}) {
  const { db } = await import("@/lib/db");
  const org = await db.organization.create({ data: { name: "o" } });
  const domain = await db.domain.create({ data: { orgId: org.id, hostname: `s${Math.random().toString(36).slice(2)}.com`, ...extra } });
  return { db, org, domain };
}

test("nextRun advances by a week or a calendar month; off means never", async () => {
  const { nextRun } = await import("@/lib/jobs");
  const from = new Date("2026-01-31T10:00:00Z");
  assert.equal(nextRun("weekly", from)!.toISOString(), "2026-02-07T10:00:00.000Z");
  assert.equal(nextRun("monthly", new Date("2026-03-15T10:00:00Z"))!.toISOString(), "2026-04-15T10:00:00.000Z");
  assert.equal(nextRun("off", from), null);
});

test("due audits start once, advance the due date, and ignore off / not-yet-due sites", async () => {
  const { runDueSchedules } = await import("@/worker/scheduler");
  const now = new Date("2026-05-01T00:00:00Z");
  const due = await setup({ auditSchedule: "weekly", nextAuditAt: new Date("2026-04-30T00:00:00Z") });
  const notDue = await setup({ auditSchedule: "weekly", nextAuditAt: new Date("2026-05-02T00:00:00Z") });
  const off = await setup({ auditSchedule: "off", nextAuditAt: new Date("2026-04-01T00:00:00Z") });
  await runDueSchedules(now);
  await runDueSchedules(now); // a second poll in the same instant must not double-start
  const { db } = due;
  assert.equal(await db.crawl.count({ where: { domainId: due.domain.id } }), 1);
  assert.equal(await db.job.count({ where: { orgId: due.org.id, type: "crawl" } }), 1);
  assert.equal((await db.domain.findUniqueOrThrow({ where: { id: due.domain.id } })).nextAuditAt!.toISOString(), "2026-05-08T00:00:00.000Z");
  assert.equal(await db.crawl.count({ where: { domainId: notDue.domain.id } }), 0);
  assert.equal(await db.crawl.count({ where: { domainId: off.domain.id } }), 0);
});

test("a due audit while one is already running reuses it", async () => {
  const { runDueSchedules } = await import("@/worker/scheduler");
  const { db, org, domain } = await setup({ auditSchedule: "monthly", nextAuditAt: new Date("2026-01-01T00:00:00Z") });
  await db.crawl.create({ data: { orgId: org.id, domainId: domain.id, status: "running" } });
  await runDueSchedules(new Date("2026-01-02T00:00:00Z"));
  assert.equal(await db.crawl.count({ where: { domainId: domain.id } }), 1);
});

test("scheduled visibility checks need keys and prompts, but always move the due date on", async () => {
  const { runDueSchedules } = await import("@/worker/scheduler");
  const now = new Date("2026-06-01T00:00:00Z");
  delete process.env.OPENAI_API_KEY;
  const noKeys = await setup({ visibilitySchedule: "weekly", nextVisibilityAt: new Date("2026-05-31T00:00:00Z") });
  await noKeys.db.prompt.create({ data: { domainId: noKeys.domain.id, text: "best thing?" } });
  await runDueSchedules(now);
  assert.equal(await noKeys.db.visibilityRun.count({ where: { domainId: noKeys.domain.id } }), 0);
  assert.ok((await noKeys.db.domain.findUniqueOrThrow({ where: { id: noKeys.domain.id } })).nextVisibilityAt! > now);

  process.env.OPENAI_API_KEY = "k";
  try {
    const ready = await setup({ visibilitySchedule: "weekly", visibilityTrials: 10, nextVisibilityAt: new Date("2026-05-31T00:00:00Z") });
    await ready.db.prompt.create({ data: { domainId: ready.domain.id, text: "best thing?" } });
    const noPrompts = await setup({ visibilitySchedule: "weekly", nextVisibilityAt: new Date("2026-05-31T00:00:00Z") });
    await runDueSchedules(now);
    const run = await ready.db.visibilityRun.findFirstOrThrow({ where: { domainId: ready.domain.id } });
    assert.equal(run.trials, 10);
    assert.equal(run.engines, "chatgpt");
    assert.equal(await ready.db.job.count({ where: { orgId: ready.org.id, type: "visibility" } }), 1);
    assert.equal(await ready.db.visibilityRun.count({ where: { domainId: noPrompts.domain.id } }), 0);
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test("significantDrop ignores normal variation and catches real drops", async () => {
  const { significantDrop } = await import("@/worker/alerts");
  assert.equal(significantDrop({ hits: 5, n: 5 }, { hits: 0, n: 5 }), true);
  assert.equal(significantDrop({ hits: 3, n: 5 }, { hits: 2, n: 5 }), false);
  assert.equal(significantDrop({ hits: 4, n: 5 }, { hits: 1, n: 5 }), false, "plausible noise at n=5");
  assert.equal(significantDrop({ hits: 9, n: 10 }, { hits: 1, n: 10 }), true);
  assert.equal(significantDrop({ hits: 0, n: 5 }, { hits: 0, n: 5 }), false);
  assert.equal(significantDrop({ hits: 5, n: 5 }, { hits: 0, n: 0 }), false, "all-error run is not a drop");
});

async function visRun(db: Awaited<ReturnType<typeof setup>>["db"], orgId: string, domainId: string, promptId: string, cited: boolean[], at: Date) {
  const run = await db.visibilityRun.create({ data: { orgId, domainId, engines: "chatgpt", trials: cited.length, status: "completed", createdAt: at } });
  await db.visibilityResult.createMany({ data: cited.map((c, i) => ({ runId: run.id, promptId, engine: "chatgpt", trial: i + 1, cited: c, mentioned: c })) });
  return run;
}

test("visibility alert fires on a real drop only, once per question and engine", async () => {
  const { visibilityAlerts } = await import("@/worker/alerts");
  const { db, org, domain } = await setup();
  const lost = await db.prompt.create({ data: { domainId: domain.id, text: "best mail scanning?" } });
  const wobble = await db.prompt.create({ data: { domainId: domain.id, text: "cheapest mail scanning?" } });
  const t0 = new Date("2026-01-01T00:00:00Z");
  const t1 = new Date("2026-01-08T00:00:00Z");
  const r0a = await visRun(db, org.id, domain.id, lost.id, [true, true, true, true, true], t0);
  await db.visibilityResult.createMany({ data: [true, true, true, false, false].map((c, i) => ({ runId: r0a.id, promptId: wobble.id, engine: "chatgpt", trial: i + 1, cited: c, mentioned: c })) });
  const r1 = await visRun(db, org.id, domain.id, lost.id, [false, false, false, false, false], t1);
  await db.visibilityResult.createMany({ data: [true, true, false, false, false].map((c, i) => ({ runId: r1.id, promptId: wobble.id, engine: "chatgpt", trial: i + 1, cited: c, mentioned: c })) });

  assert.equal(await visibilityAlerts(r1.id), 1);
  const alert = await db.alert.findFirstOrThrow({ where: { domainId: domain.id } });
  assert.equal(alert.kind, "visibility_drop");
  assert.match(alert.title, /ChatGPT stopped linking to you for “best mail scanning\?”/);
  assert.match(alert.detail, /5\/5.*0\/5/);
  assert.match(alert.detail, /What to check/);
});

test("first-ever run creates no visibility alerts", async () => {
  const { visibilityAlerts } = await import("@/worker/alerts");
  const { db, org, domain } = await setup();
  const p = await db.prompt.create({ data: { domainId: domain.id, text: "q?" } });
  const r = await visRun(db, org.id, domain.id, p.id, [false, false, false], new Date());
  assert.equal(await visibilityAlerts(r.id), 0);
});

test("crawl alerts: search bot newly blocked and new urgent issue; training bots and old issues ignored", async () => {
  const { crawlAlerts } = await import("@/worker/alerts");
  const { db, org, domain } = await setup();
  const bots = (search: boolean, training: boolean) =>
    JSON.stringify([
      { userAgent: "OAI-SearchBot", company: "OpenAI", engine: "ChatGPT Search", purpose: "search", allowed: search },
      { userAgent: "GPTBot", company: "OpenAI", engine: "OpenAI model training", purpose: "training", allowed: training },
      { userAgent: "Claude-SearchBot", company: "Anthropic", engine: "Claude search", purpose: "search", allowed: true, reachable: true },
    ]);
  const mk = async (at: Date, search: boolean, training: boolean, highCodes: string[], claudeReachable = true) => {
    const c = await db.crawl.create({ data: { orgId: org.id, domainId: domain.id, status: "completed", createdAt: at } });
    const botJson = JSON.parse(bots(search, training));
    botJson[2].reachable = claudeReachable;
    await db.robotsReport.create({ data: { crawlId: c.id, robotsUrl: "x", botAccess: JSON.stringify(botJson) } });
    await db.finding.createMany({ data: highCodes.map((code) => ({ crawlId: c.id, layer: "seo", code, severity: "high", evidence: "proven", title: `T ${code}`, detail: "d" })) });
    return c;
  };
  await mk(new Date("2026-01-01"), true, true, ["missing_title"]);
  const now = await mk(new Date("2026-01-08"), false, false, ["missing_title", "noindex", "bot_blocked_oai-searchbot"], false);
  assert.equal(await crawlAlerts(now.id), 3);
  const titles = (await db.alert.findMany({ where: { domainId: domain.id } })).map((a) => a.title).sort();
  assert.deepEqual(titles, [
    `Claude-SearchBot can no longer read ${domain.hostname}`,
    "New urgent issue: T noindex",
    `OAI-SearchBot can no longer read ${domain.hostname}`,
  ]);
});
