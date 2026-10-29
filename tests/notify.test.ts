import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { startSmtpSink } from "./helpers/smtp-sink";

process.env.DATABASE_URL = "file:./notify-test.db";
process.env.APP_URL = "https://app.example";
let sink: Awaited<ReturnType<typeof startSmtpSink>>;

before(async () => {
  fs.rmSync("notify-test.db", { force: true });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
  sink = await startSmtpSink(2527);
  process.env.SMTP_URL = "smtp://127.0.0.1:2527?ignoreTLS=true";
  process.env.MAIL_FROM = "reports@app.example";
});
after(async () => {
  await sink.close();
  await (await import("@/lib/db")).db.$disconnect();
  fs.rmSync("notify-test.db", { force: true });
  delete process.env.SMTP_URL;
});

const decode = (raw: string) => { const soft = raw.replace(/=\r?\n/g, ""); return Buffer.from(soft.replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8"); };

async function world() {
  const { db } = await import("@/lib/db");
  const user = (email: string, verified: boolean) => db.user.create({ data: { email, name: email, passwordHash: "x", emailVerifiedAt: verified ? new Date() : null } });
  const agency = await db.organization.create({ data: { name: "Northwind", kind: "agency", brandName: "Northwind SEO", reportFooter: "Prepared by Northwind" } });
  const client = await db.organization.create({ data: { name: "Acme Bakery", kind: "client", parentId: agency.id, reportRecipients: "owner@acme.example" } });
  const staff = await user(`staff${Math.random()}@northwind.example`, true);
  const unverified = await user(`new${Math.random()}@northwind.example`, false);
  await db.membership.createMany({ data: [{ userId: staff.id, orgId: agency.id }, { userId: unverified.id, orgId: agency.id }] });
  const domain = await db.domain.create({ data: { orgId: client.id, hostname: "acmebakery.example" } });
  return { db, agency, client, staff, unverified, domain };
}

test("alerts are emailed once, grouped per workspace, to confirmed members (agency staff for clients), escaped, white-labelled", async () => {
  const { db, client, staff, unverified, domain } = await world();
  const { deliverAlerts } = await import("@/lib/notify");
  sink.messages.length = 0;
  await db.alert.createMany({
    data: [
      { orgId: client.id, domainId: domain.id, kind: "bot_blocked", title: "OAI-SearchBot can no longer read acmebakery.example", detail: "d1", link: `/dashboard/crawls/x` },
      { orgId: client.id, domainId: domain.id, kind: "new_issue", title: "<script>alert(1)</script>", detail: "d2" },
    ],
  });
  assert.equal(await deliverAlerts(), 1);
  assert.equal(sink.messages.length, 1);
  const m = sink.messages[0];
  assert.deepEqual(m.to, [staff.email.toLowerCase()], "unverified members and report-only recipients don't get alerts");
  assert.ok(!m.to.includes(unverified.email));
  const raw = decode(m.raw);
  assert.match(raw, /Subject: Acme Bakery: 2 new alerts/);
  assert.match(raw, /From: Northwind SEO <reports@app\.example>/);
  assert.ok(raw.includes("&lt;script&gt;") && !raw.includes("<li><strong><script>"), "HTML body escapes alert text");
  assert.match(raw, /https:\/\/app\.example\/dashboard\/crawls\/x/);
  assert.equal(await deliverAlerts(), 0, "nothing re-sent");
  assert.equal(sink.messages.length, 1);
});

test("alert emails switched off: nothing sent, alerts still marked so they don't flood in later", async () => {
  const { db, client, domain } = await world();
  const { deliverAlerts } = await import("@/lib/notify");
  await db.organization.update({ where: { id: client.id }, data: { alertEmails: false } });
  sink.messages.length = 0;
  await db.alert.create({ data: { orgId: client.id, domainId: domain.id, kind: "new_issue", title: "t", detail: "d" } });
  await deliverAlerts();
  assert.equal(sink.messages.length, 0);
  assert.equal(await db.alert.count({ where: { orgId: client.id, emailedAt: null } }), 0);
});

test("scheduled report: due ones sent once with site summary and footer, to members plus extra recipients; date advances", async () => {
  const { db, client, staff, domain } = await world();
  const { deliverDueReports, parseRecipients } = await import("@/lib/notify");
  const crawl = await db.crawl.create({ data: { orgId: client.id, domainId: domain.id, status: "completed" } });
  await db.finding.create({ data: { crawlId: crawl.id, layer: "seo", code: "x", severity: "high", evidence: "proven", title: "t", detail: "d" } });
  const p = await db.prompt.create({ data: { domainId: domain.id, text: "q?" } });
  const run = await db.visibilityRun.create({ data: { orgId: client.id, domainId: domain.id, engines: "chatgpt", status: "completed" } });
  await db.visibilityResult.createMany({ data: [true, false, true, true].map((m, i) => ({ runId: run.id, promptId: p.id, engine: "chatgpt", trial: i, mentioned: m })) });
  const now = new Date("2026-11-02T09:00:00Z");
  await db.organization.update({ where: { id: client.id }, data: { reportSchedule: "weekly", nextReportAt: new Date("2026-11-01T00:00:00Z") } });
  sink.messages.length = 0;
  assert.equal(await deliverDueReports(now), 1);
  assert.equal(await deliverDueReports(now), 0, "not sent twice");
  const m = sink.messages[0];
  assert.deepEqual(m.to.sort(), [staff.email.toLowerCase(), "owner@acme.example"].sort());
  const raw = decode(m.raw);
  assert.match(raw, /acmebakery\.example: health 85\/100, 1 urgent issues, mentioned in 75% \(\d+%–\d+%\) of AI answers/);
  assert.match(raw, /Prepared by Northwind/);
  assert.equal((await db.organization.findUniqueOrThrow({ where: { id: client.id } })).nextReportAt!.toISOString(), "2026-11-09T09:00:00.000Z");
  assert.deepEqual(parseRecipients("a@b.co, A@B.co; c@d.io\nnot-an-email"), { emails: ["a@b.co", "c@d.io", "not-an-email"], bad: ["not-an-email"] });
});
