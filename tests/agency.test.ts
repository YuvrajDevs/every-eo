import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execSync } from "node:child_process";

process.env.DATABASE_URL = "file:./agency-test.db";
before(() => {
  fs.rmSync("agency-test.db", { force: true });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
});
after(async () => {
  await (await import("@/lib/db")).db.$disconnect();
  fs.rmSync("agency-test.db", { force: true });
});

async function world() {
  const { db } = await import("@/lib/db");
  const { createClientWorkspace } = await import("@/lib/access");
  const user = (email: string) => db.user.create({ data: { email, name: email, passwordHash: "x" } });
  const agencyA = await db.organization.create({ data: { name: "Agency A", kind: "agency" } });
  const agencyB = await db.organization.create({ data: { name: "Agency B", kind: "agency" } });
  const standard = await db.organization.create({ data: { name: "Solo" } });
  const clientA1 = await createClientWorkspace(agencyA.id, "Client A1");
  const clientA2 = await createClientWorkspace(agencyA.id, "Client A2");
  const clientB1 = await createClientWorkspace(agencyB.id, "Client B1");
  const alice = await user(`alice${Math.random()}@a.co`); // agency A staff
  const bob = await user(`bob${Math.random()}@b.co`); // agency B staff
  const carol = await user(`carol${Math.random()}@c.co`); // invited directly into client A1 only
  await db.membership.createMany({ data: [{ userId: alice.id, orgId: agencyA.id }, { userId: bob.id, orgId: agencyB.id }, { userId: carol.id, orgId: clientA1.id, role: "member" }] });
  return { db, agencyA, agencyB, standard, clientA1, clientA2, clientB1, alice, bob, carol };
}

test("agency staff can enter their own clients only; client members can't climb to the agency or siblings", async () => {
  const { resolveAccess } = await import("@/lib/access");
  const w = await world();
  const a1 = await resolveAccess(w.alice.id, w.clientA1.id);
  assert.equal(a1?.role, "agency");
  assert.equal(a1?.agency?.id, w.agencyA.id);
  assert.equal((await resolveAccess(w.alice.id, w.agencyA.id))?.role, "owner");
  assert.equal(await resolveAccess(w.alice.id, w.clientB1.id), null, "other agency's client");
  assert.equal(await resolveAccess(w.bob.id, w.clientA1.id), null);
  assert.equal((await resolveAccess(w.carol.id, w.clientA1.id))?.role, "member");
  assert.equal(await resolveAccess(w.carol.id, w.agencyA.id), null, "client member can't reach the agency");
  assert.equal(await resolveAccess(w.carol.id, w.clientA2.id), null, "or a sibling client");
  assert.equal(await resolveAccess(w.alice.id, w.standard.id), null);
  assert.equal(await resolveAccess(w.alice.id, "does-not-exist"), null);
});

test("only agencies can create client workspaces; a client can't own clients", async () => {
  const { createClientWorkspace, resolveAccess } = await import("@/lib/access");
  const w = await world();
  await assert.rejects(createClientWorkspace(w.standard.id, "x"), /Only agency/);
  await assert.rejects(createClientWorkspace(w.clientA1.id, "x"), /Only agency/);
  // Even if a row pointed a client at another client, access never chains more than one level.
  const nested = await w.db.organization.create({ data: { name: "nested", kind: "client", parentId: w.clientA1.id } });
  assert.equal(await resolveAccess(w.alice.id, nested.id), null);
});

test("deleting an agency removes its client workspaces and their data", async () => {
  const w = await world();
  await w.db.domain.create({ data: { orgId: w.clientA1.id, hostname: "a1.com" } });
  await w.db.organization.delete({ where: { id: w.agencyA.id } });
  assert.equal(await w.db.organization.count({ where: { parentId: w.agencyA.id } }), 0);
  assert.equal(await w.db.domain.count({ where: { hostname: "a1.com" } }), 0);
});

test("client console summary: sites, average health, mention rate, unread alerts, usage", async () => {
  const { clientSummaries } = await import("@/lib/clients");
  const w = await world();
  const d = await w.db.domain.create({ data: { orgId: w.clientA1.id, hostname: "acme.com" } });
  const crawl = await w.db.crawl.create({ data: { orgId: w.clientA1.id, domainId: d.id, status: "completed" } });
  await w.db.finding.create({ data: { crawlId: crawl.id, layer: "seo", code: "x", severity: "high", evidence: "proven", title: "t", detail: "d" } });
  const p = await w.db.prompt.create({ data: { domainId: d.id, text: "q?" } });
  const run = await w.db.visibilityRun.create({ data: { orgId: w.clientA1.id, domainId: d.id, engines: "chatgpt", status: "completed" } });
  await w.db.visibilityResult.createMany({ data: [true, false, false, true].map((m, i) => ({ runId: run.id, promptId: p.id, engine: "chatgpt", trial: i, mentioned: m })) });
  await w.db.alert.create({ data: { orgId: w.clientA1.id, domainId: d.id, kind: "new_issue", title: "t", detail: "d" } });
  const rows = await clientSummaries(w.agencyA.id);
  assert.deepEqual(rows.map((r) => r.name), ["Client A1", "Client A2"]);
  assert.deepEqual(rows[0], { id: w.clientA1.id, name: "Client A1", sites: 1, health: 85, mentionRate: 0.5, unreadAlerts: 1, answersThisMonth: 4 });
  assert.equal(rows[1].health, null);
});
