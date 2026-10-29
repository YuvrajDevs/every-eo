// Full-stack check: real Next server + real worker process + real browser + fixture website.
// Run with: npm run test:ui   (needs `npm run build` first; binds ports 80 and 3100)
import { spawn, execSync, type ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, type Page } from "playwright-core";
import { startFixture } from "../fixture";

const DB = "file:./ui-test.db";
process.env.DATABASE_URL = DB;
const BASE = "http://localhost:3100";
const env = {
  ...process.env,
  DATABASE_URL: DB,
  SESSION_SECRET: "ui-test-secret-ui-test-secret-1234",
  OPENAI_API_KEY: "bogus-key-for-failure-path",
  PSI_API_KEY: "",
};
const procs: ChildProcess[] = [];
let passed = 0;
const step = (name: string) => {
  console.log(`  ✓ ${name}`);
  passed++;
};

async function waitFor(fn: () => Promise<boolean>, what: string, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function text(p: Page) {
  return p.innerText("body");
}

async function signup(p: Page, name: string, email: string, password = "password1234") {
  await p.goto(`${BASE}/signup`);
  await p.fill("input[name=name]", name);
  await p.fill("input[name=company]", `${name} Co`);
  await p.fill("input[name=email]", email);
  await p.fill("input[name=password]", password);
  await p.click("form button");
}

async function main() {
  fs.rmSync("ui-test.db", { force: true });
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  const fixture = await startFixture();
  procs.push(spawn("npx", ["next", "start", "-p", "3100"], { env: { ...env, NODE_ENV: "production" }, stdio: "ignore" }));
  // Worker runs in test mode so it may crawl the localhost fixture; the web app never fetches sites itself.
  procs.push(spawn("npx", ["tsx", "src/worker/index.ts"], { env: { ...env, NODE_ENV: "test", AUDIT_TEST_ALLOW_PRIVATE: "1", RENDER_CHECK: process.env.RENDER_CHECK ?? "" }, stdio: "ignore" }));
  await waitFor(async () => (await fetch(`${BASE}/login`)).ok, "web server");
  const { db } = await import("@/lib/db");

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const pageErrors: string[] = [];
  a.on("pageerror", (e) => pageErrors.push(e.message));

  console.log("Auth");
  await a.goto(`${BASE}/dashboard`);
  assert.match(a.url(), /\/login/);
  step("signed-out dashboard redirects to login");

  await signup(a, "Alice", "alice@example.com", "short");
  await a.waitForTimeout(800);
  assert.match(a.url(), /signup/);
  assert.equal(await db.user.count(), 0);
  step("short password blocked (browser validation) and no account created");
  await signup(a, "Alice", "not-an-email");
  await a.waitForTimeout(800);
  assert.match(a.url(), /signup/);
  assert.equal(await db.user.count(), 0);
  step("invalid email blocked and no account created");
  await signup(a, "Alice", "alice@example.com");
  await a.waitForURL(/\/dashboard/);
  step("sign up succeeds and lands on dashboard");

  await a.click("button[aria-label='Log out'] >> visible=true");
  await a.waitForURL(/\/login/);
  await a.fill("input[name=email]", "alice@example.com");
  await a.fill("input[name=password]", "wrong-password-1");
  await a.click("form button");
  await a.waitForSelector("text=Email or password is incorrect");
  step("wrong password rejected with generic message");
  await a.fill("input[name=email]", "nobody@example.com");
  await a.click("form button");
  await a.waitForSelector("text=Email or password is incorrect");
  step("unknown email gives the same message");
  await a.fill("input[name=email]", "ALICE@example.com");
  await a.fill("input[name=password]", "password1234");
  await a.click("form button");
  await a.waitForURL(/\/dashboard/);
  step("login works (email case-insensitive)");

  await signup(a, "Dup", "alice@example.com");
  await a.waitForSelector("text=already exists");
  step("duplicate email rejected");
  await a.goto(`${BASE}/dashboard`);

  console.log("Adding sites");
  await a.goto(`${BASE}/dashboard/sites`);
  for (const bad of ["localhost", "10.0.0.1", "intranet.local", "nodots"]) {
    await a.fill("input[name=domain]", bad);
    await a.click("form:has(input[name=domain]) button");
    await a.waitForSelector("text=public website", { timeout: 5000 }).catch(async () => {
      assert.fail(`no error for ${bad}: ${(await text(a)).slice(0, 200)}`);
    });
  }
  step("localhost / private IP / .local / dotless rejected");

  // A real public domain: the sandbox has no internet, so the crawl must fail cleanly and retry, not hang.
  await a.fill("input[name=domain]", "https://Example.com/some/path");
  await a.click("form:has(input[name=domain]) button");
  await a.waitForURL(/\/dashboard\/crawls\//, { timeout: 15000 }).catch(async () => assert.fail(`no redirect: ${(await text(a)).slice(0, 400)}`));
  const exampleCrawlId = a.url().split("/").pop()!;
  const org = (await db.membership.findFirstOrThrow({ where: { user: { email: "alice@example.com" } }, include: { org: true } })).org;
  assert.equal((await db.domain.findFirstOrThrow({ where: { orgId: org.id, hostname: "example.com" } })).hostname, "example.com");
  step("domain normalised to example.com and audit queued");
  await waitFor(async () => {
    const j = await db.job.findFirst({ where: { orgId: org.id, type: "crawl", error: { not: null } } });
    return !!j && j.attempts >= 1;
  }, "failed crawl to be retried", 30_000);
  const job = await db.job.findFirstOrThrow({ where: { orgId: org.id, type: "crawl" } });
  assert.ok(["queued", "failed"].includes(job.status), `job status ${job.status}`);
  assert.ok(job.status === "failed" || job.runAt.getTime() > Date.now() - 1000, "retry scheduled in the future");
  step(`unreachable site: job attempt recorded (${job.status}), not stuck running`);
  await a.goto(`${BASE}/dashboard/crawls/${exampleCrawlId}`);
  assert.ok(!/Application error/.test(await text(a)));
  step("crawl page renders for in-progress/failed audit");

  // Re-adding the same domain must not create a duplicate domain or a second active crawl.
  await a.goto(`${BASE}/dashboard/sites`);
  await a.fill("input[name=domain]", "example.com");
  await a.click("form:has(input[name=domain]) button");
  await a.waitForURL(/\/dashboard\/crawls\//);
  assert.equal(a.url().split("/").pop(), exampleCrawlId);
  assert.equal(await db.domain.count({ where: { orgId: org.id, hostname: "example.com" } }), 1);
  assert.equal(await db.crawl.count({ where: { orgId: org.id } }), 1);
  step("re-adding a site reuses the active audit");

  console.log("Audit of the fixture site (worker + browser render)");
  const domain = await db.domain.create({ data: { orgId: org.id, hostname: "localhost", brandName: "Acme" } });
  const seedCrawl = await db.crawl.create({ data: { orgId: org.id, domainId: domain.id, status: "failed", error: "seed" } });
  await a.goto(`${BASE}/dashboard/crawls/${seedCrawl.id}`);
  await a.click("button:has-text('Run again')");
  await a.waitForURL((u) => u.pathname.startsWith("/dashboard/crawls/") && !u.pathname.endsWith(seedCrawl.id));
  const crawlUrl = a.url();
  const crawlId = crawlUrl.split("/").pop()!;
  assert.notEqual(crawlId, seedCrawl.id);
  await waitFor(async () => (await db.crawl.findUnique({ where: { id: crawlId } }))?.status === "completed", "fixture audit to complete", 90_000);
  await a.goto(crawlUrl);
  let body = await text(a);
  for (const expected of ["Technical health", "PerplexityBot is blocked", "mostly empty without JavaScript", "FAQ questions in schema", "Pages checked"]) {
    assert.ok(body.includes(expected), `audit page missing "${expected}"`);
  }
  step("audit completes through the worker; key findings visible");
  assert.ok(body.includes("Firewall blocks"), "firewall-blocked bot shown");
  assert.ok(body.includes("Blocked"), "robots-blocked bot shown");
  step("bot panel shows robots block and firewall block");
  await a.click("a:has-text('AEO')");
  await a.waitForTimeout(800);
  body = await text(a);
  assert.match(a.url(), /layer=aeo/);
  assert.ok(!body.includes("PerplexityBot is blocked"), `AEO filter should hide GEO findings; found near: ${body.slice(Math.max(0, body.indexOf("PerplexityBot is blocked") - 80), body.indexOf("PerplexityBot is blocked") + 120)}`);
  step("layer filter works");
  await a.goto(`${crawlUrl}/report`);
  body = await text(a);
  assert.ok(body.includes("Proven") && body.includes("Plausible"));
  assert.ok(!/NaN|undefined|\[object/.test(body), "report contains NaN/undefined");
  step("report renders with evidence grades and no NaN/undefined");

  console.log("Visibility");
  await a.goto(`${BASE}/dashboard/visibility/${domain.id}`);
  for (const bad of ["hi", "x".repeat(301)]) {
    await a.fill("input[name=text]", bad);
    await a.click("form:has(input[name=text]) button");
    await a.waitForTimeout(700);
  }
  assert.equal(await db.prompt.count({ where: { domainId: domain.id } }), 0);
  step("too-short and too-long questions rejected");
  for (let i = 1; i <= 16; i++) {
    await a.fill("input[name=text]", `What is the best remote mail service number ${i}?`);
    await a.click("form:has(input[name=text]) button");
    await a.waitForTimeout(250);
  }
  await waitFor(async () => (await db.prompt.count({ where: { domainId: domain.id } })) === 15, "prompt cap", 10_000);
  await a.waitForTimeout(500);
  assert.equal(await db.prompt.count({ where: { domainId: domain.id } }), 15);
  assert.ok((await text(a)).includes("up to 15 questions"));
  step("question cap of 15 enforced with message");
  const first = await db.prompt.findFirstOrThrow({ where: { domainId: domain.id }, orderBy: { createdAt: "asc" } });
  await a.click(`button[title="Remove"] >> nth=0`);
  await waitFor(async () => (await db.prompt.count({ where: { domainId: domain.id } })) === 14, "prompt delete", 10_000);
  assert.equal(await db.prompt.count({ where: { id: first.id } }), 0);
  step("deleting a question works");
  await db.prompt.deleteMany({ where: { domainId: domain.id, NOT: { id: { in: (await db.prompt.findMany({ where: { domainId: domain.id }, take: 2 })).map((p) => p.id) } } } });

  await a.goto(`${BASE}/dashboard/visibility/${domain.id}`);
  await a.fill("input[name=brandName]", "Acme Mail");
  await a.click("form:has(input[name=brandName]) button");
  await waitFor(async () => (await db.domain.findUnique({ where: { id: domain.id } }))?.brandName === "Acme Mail", "brand name saved", 10_000);
  step("brand name saves");

  await a.goto(`${BASE}/dashboard/visibility/${domain.id}`);
  await a.click("button:has-text('Run check')");
  await waitFor(async () => {
    const r = await db.visibilityRun.findFirst({ where: { domainId: domain.id } });
    return r?.status === "completed" || r?.status === "failed";
  }, "visibility run to finish", 90_000);
  const run = await db.visibilityRun.findFirstOrThrow({ where: { domainId: domain.id }, include: { results: true } });
  assert.equal(run.results.length, 2 * run.trials);
  assert.ok(run.results.every((r) => r.error), "bogus key => every call recorded as error");
  const jobAfter = await db.job.findFirstOrThrow({ where: { type: "visibility" } });
  assert.equal(jobAfter.attempts, 1, "visibility jobs must not auto-retry (they cost money)");
  await a.goto(`${BASE}/dashboard/visibility/${domain.id}`);
  body = await text(a);
  assert.ok(body.includes("engines returned errors"), "error card shown");
  assert.ok(!/NaN|undefined/.test(body));
  step("failed AI calls: every trial recorded as an error, no auto-retry, clear error card");

  console.log("Tenant isolation");
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await signup(b, "Bob", "bob@example.com");
  await b.waitForURL(/\/dashboard/);
  for (const path of [`/dashboard/crawls/${crawlId}`, `/dashboard/crawls/${crawlId}/report`, `/dashboard/visibility/${domain.id}`]) {
    const res = await b.goto(`${BASE}${path}`);
    assert.equal(res?.status(), 404, `Bob could open Alice's ${path}`);
  }
  step("another organisation gets 404 on crawl, report and visibility pages");
  await b.goto(`${BASE}/dashboard/sites`);
  assert.ok(!(await text(b)).includes("localhost") && !(await text(b)).includes("example.com"));
  await b.goto(`${BASE}/dashboard/costs`);
  assert.ok(!(await text(b)).includes("ChatGPT"));
  step("sites and costs lists contain no other organisation's data");
  assert.ok((await db.membership.count()) === 2);

  // Tampered cookie is rejected.
  const cookies = await ctxB.cookies();
  const session = cookies.find((c) => c.name === "session")!;
  await ctxB.clearCookies();
  await ctxB.addCookies([{ ...session, value: session.value.slice(0, -3) + "abc" }]);
  await b.goto(`${BASE}/dashboard`);
  assert.match(b.url(), /\/login/);
  step("tampered session cookie is rejected");

  assert.deepEqual(pageErrors, [], "browser page errors");
  step("no uncaught browser errors");

  await browser.close();
  await db.$disconnect();
  fixture.close();
  console.log(`\n${passed} checks passed`);
}

main()
  .then(() => cleanup(0))
  .catch((e) => {
    console.error("\nFAILED:", e);
    cleanup(1);
  });

function cleanup(code: number) {
  for (const p of procs) p.kill("SIGKILL");
  try {
    execSync("pkill -f next-server || true; pkill -f 'src/worker/index.ts' || true", { stdio: "ignore", shell: "/bin/bash" });
  } catch {}
  fs.rmSync("ui-test.db", { force: true });
  process.exit(code);
}
