import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execSync } from "node:child_process";

process.env.DATABASE_URL = "file:./api-test.db";
before(() => {
  fs.rmSync("api-test.db", { force: true });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
});
after(async () => {
  await (await import("@/lib/db")).db.$disconnect();
  fs.rmSync("api-test.db", { force: true });
});

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const call = async (handler: Handler, headers: Record<string, string>, params: { id: string } = { id: "" }) => {
  const res = await handler(new Request("http://x/api", { headers }), { params: Promise.resolve(params) });
  return { status: res.status, body: await res.json() };
};

async function setup() {
  const { db } = await import("@/lib/db");
  const { createApiKey } = await import("@/lib/api");
  const adv = await db.organization.create({ data: { name: "Adv", plan: "advanced" } });
  const trial = await db.organization.create({ data: { name: "Trial" } });
  const agency = await db.organization.create({ data: { name: "Ag", kind: "agency", plan: "agency" } });
  const client = await db.organization.create({ data: { name: "Client", kind: "client", parentId: agency.id, plan: "agency_client" } });
  const otherAgency = await db.organization.create({ data: { name: "Ag2", kind: "agency", plan: "agency" } });
  const otherClient = await db.organization.create({ data: { name: "Client2", kind: "client", parentId: otherAgency.id } });
  const site = await db.domain.create({ data: { orgId: adv.id, hostname: "adv.com" } });
  const clientSite = await db.domain.create({ data: { orgId: client.id, hostname: "client.com" } });
  const crawl = await db.crawl.create({ data: { orgId: adv.id, domainId: site.id, status: "completed", pagesCount: 3, platform: "wordpress", finishedAt: new Date() } });
  await db.finding.create({ data: { crawlId: crawl.id, layer: "geo", code: "bot_blocked_x", severity: "high", evidence: "proven", title: "Blocked", detail: "d" } });
  const p = await db.prompt.create({ data: { domainId: site.id, text: "q?" } });
  const run = await db.visibilityRun.create({ data: { orgId: adv.id, domainId: site.id, engines: "chatgpt,claude", trials: 2, status: "completed" } });
  await db.visibilityResult.createMany({
    data: [
      { runId: run.id, promptId: p.id, engine: "chatgpt", trial: 1, mentioned: true, cited: true },
      { runId: run.id, promptId: p.id, engine: "chatgpt", trial: 2, mentioned: false },
      { runId: run.id, promptId: p.id, engine: "claude", trial: 1, mentioned: true },
      { runId: run.id, promptId: p.id, engine: "claude", trial: 2, error: "429" },
    ],
  });
  return {
    db,
    adv,
    agency,
    client,
    otherClient,
    site,
    clientSite,
    advKey: (await createApiKey(adv.id, "k")).key,
    trialKey: (await createApiKey(trial.id, "k")).key,
    agencyKey: (await createApiKey(agency.id, "k")).key,
    otherAgencyKey: (await createApiKey(otherAgency.id, "k")).key,
  };
}

test("keys: only a hash is stored; bad, missing and revoked keys get 401; plans without API get 403", async () => {
  const s = await setup();
  const { GET } = await import("@/app/api/v1/sites/route");
  const stored = await s.db.apiKey.findFirstOrThrow({ where: { orgId: s.adv.id } });
  assert.notEqual(stored.hash, s.advKey);
  assert.ok(s.advKey.startsWith(stored.prefix));
  assert.equal((await call(GET, {})).status, 401);
  assert.equal((await call(GET, { authorization: "Bearer vis_nope" })).status, 401);
  assert.equal((await call(GET, { authorization: s.advKey })).status, 401, "missing Bearer scheme");
  assert.equal((await call(GET, { authorization: `Bearer ${s.trialKey}` })).body.error.code, "plan");
  await s.db.apiKey.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  assert.equal((await call(GET, { authorization: `Bearer ${s.advKey}` })).status, 401);
});

test("sites, audit and visibility endpoints return this workspace's data with confidence ranges", async () => {
  const s = await setup();
  const auth = { authorization: `Bearer ${s.advKey}` };
  const sites = await call((await import("@/app/api/v1/sites/route")).GET, auth);
  assert.equal(sites.status, 200);
  assert.deepEqual(sites.body.data.map((x: { hostname: string }) => x.hostname), ["adv.com"]);
  assert.equal(sites.body.data[0].latestAudit.health, 85);
  const audit = await call((await import("@/app/api/v1/sites/[id]/audit/route")).GET, auth, { id: s.site.id });
  assert.equal(audit.body.data.platform, "wordpress");
  assert.equal(audit.body.data.findings[0].code, "bot_blocked_x");
  const vis = await call((await import("@/app/api/v1/sites/[id]/visibility/route")).GET, auth, { id: s.site.id });
  assert.equal(vis.body.data.overall.answers, 3, "errored answers excluded");
  assert.ok(Math.abs(vis.body.data.overall.mentionRate - 2 / 3) < 1e-9);
  assert.ok(vis.body.data.overall.mentionLow < vis.body.data.overall.mentionRate && vis.body.data.overall.mentionHigh > vis.body.data.overall.mentionRate);
  assert.equal(vis.body.data.byEngine.claude.answers, 1);
  assert.equal(vis.body.data.byEngine.chatgpt.citedRate, 0.5);
});

test("isolation: another workspace's site is 404; agency keys reach only their own clients", async () => {
  const s = await setup();
  const audit = (await import("@/app/api/v1/sites/[id]/audit/route")).GET;
  const sites = (await import("@/app/api/v1/sites/route")).GET;
  assert.equal((await call(audit, { authorization: `Bearer ${s.agencyKey}` }, { id: s.site.id })).status, 404);
  const own = await call(sites, { authorization: `Bearer ${s.agencyKey}`, "x-workspace": s.client.id });
  assert.deepEqual(own.body.data.map((x: { hostname: string }) => x.hostname), ["client.com"]);
  assert.equal((await call(sites, { authorization: `Bearer ${s.otherAgencyKey}`, "x-workspace": s.client.id })).status, 404);
  assert.equal((await call(sites, { authorization: `Bearer ${s.advKey}`, "x-workspace": s.client.id })).status, 404);
  const clients = await call((await import("@/app/api/v1/clients/route")).GET, { authorization: `Bearer ${s.agencyKey}` });
  assert.deepEqual(clients.body.data.map((c: { name: string }) => c.name), ["Client"]);
  assert.equal((await call(audit, { authorization: `Bearer ${s.advKey}` }, { id: "nope" })).body.error.code, "not_found");
});

test("rate limit: 120 per minute per key, then 429 with retry-after; windows reset", async () => {
  const s = await setup();
  const { authenticate, ApiError } = await import("@/lib/api");
  const { rateLimit, resetRateLimits } = await import("@/lib/rate-limit");
  resetRateLimits();
  const h = new Headers({ authorization: `Bearer ${s.advKey}` });
  for (let i = 0; i < 120; i++) await authenticate(h);
  await assert.rejects(authenticate(h), (e: unknown) => e instanceof ApiError && e.status === 429);
  const { GET } = await import("@/app/api/v1/sites/route");
  const res = await GET(new Request("http://x", { headers: h }));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "60");
  assert.equal(rateLimit("w", 1, 1000, 0).ok, true);
  assert.equal(rateLimit("w", 1, 1000, 500).ok, false);
  assert.equal(rateLimit("w", 1, 1000, 1000).ok, true, "new window");
  resetRateLimits();
});

test("unexpected errors are masked as 500 without details", async () => {
  const { respond } = await import("@/lib/api");
  const orig = console.error;
  console.error = () => {};
  try {
    const res = await respond(async () => {
      throw new Error("db password is hunter2");
    });
    assert.equal(res.status, 500);
    assert.ok(!(await res.text()).includes("hunter2"));
  } finally {
    console.error = orig;
  }
});
