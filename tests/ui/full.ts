// Full-stack check: real Next server + real worker process + real browser + fixture website.
// Run with: npm run test:ui   (needs `npm run build` first; binds ports 80 and 3100)
import { spawn, execSync, type ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { startFixture } from "../fixture";

const DB = "file:./ui-test.db";
process.env.DATABASE_URL = DB;
const BASE = "http://localhost:3100";
const env = {
  ...process.env,
  DATABASE_URL: DB,
  SESSION_SECRET: "ui-test-secret-ui-test-secret-1234",
  STAFF_EMAILS: "staff@example.com",
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
  // Each child gets its own process group so cleanup can stop npx and everything it started.
  procs.push(spawn("npx", ["next", "start", "-p", "3100"], { env: { ...env, NODE_ENV: "production" }, stdio: "ignore", detached: true }));
  // Worker runs in test mode so it may crawl the localhost fixture; the web app never fetches sites itself.
  procs.push(spawn("npx", ["tsx", "src/worker/index.ts"], { env: { ...env, NODE_ENV: "test", AUDIT_TEST_ALLOW_PRIVATE: "1", RENDER_CHECK: process.env.RENDER_CHECK ?? "" }, stdio: "ignore", detached: true }));
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
  const settled = () => a.waitForFunction(() => !document.querySelector("form:has(input[name=domain]) button")?.hasAttribute("disabled"));
  for (const bad of ["localhost", "10.0.0.1", "intranet.local", "nodots"]) {
    await a.goto(`${BASE}/dashboard/sites`); // fresh form each time, so an earlier error can't satisfy the wait
    await a.fill("input[name=domain]", bad);
    await a.click("form:has(input[name=domain]) button");
    await a.waitForSelector("text=public website", { timeout: 5000 }).catch(async () => {
      assert.fail(`no error for ${bad}: ${(await text(a)).slice(0, 200)}`);
    });
    await settled();
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

  console.log("Brand profile");
  await a.goto(`${BASE}/dashboard/entity/${domain.id}`);
  await a.fill("input[name=foundingDate]", "April 2019");
  await a.click("button:has-text('Save and generate')");
  await a.waitForSelector("text=Use YYYY");
  step("invalid founding date shows a validation error");
  await a.fill("input[name=foundingDate]", "2019-04");
  await a.fill("input[name=logo]", "https://acme.example/logo.png");
  await a.fill("textarea[name=description]", "Remote mail scanning for small businesses.");
  await a.fill("textarea[name=sameAs]", "https://www.linkedin.com/company/acme\nhttps://www.crunchbase.com/organization/acme");
  await a.fill("input[name='author.0.name']", "Dana Lee");
  await a.fill("input[name='author.0.jobTitle']", "Head of Ops");
  await a.click("button:has-text('Save and generate')");
  await a.waitForSelector("text=Organization schema (homepage <head>)");
  body = await text(a);
  assert.ok(body.includes("Dana Lee: Person schema") && body.includes("Wikidata draft") && body.includes("P4264"));
  const saved = JSON.parse((await db.entityRecord.findUniqueOrThrow({ where: { domainId: domain.id } })).data);
  assert.equal(saved.authors[0].name, "Dana Lee");
  assert.equal(saved.sameAs.length, 2);
  step("brand profile saves and generates Organization/Person schema, bio and Wikidata draft");

  console.log("Fixes");
  await a.goto(`${BASE}/dashboard/fixes/${domain.id}`);
  body = await text(a);
  assert.ok(body.includes("Is this a WordPress site?"), "unknown platform can still connect WordPress");
  assert.ok(body.includes("Automatic fixes aren't available for Custom or unknown sites"));
  assert.ok(body.includes("Allow PerplexityBot in robots.txt"), "robots fix suggested");
  assert.ok(body.includes("Add complete Organization schema to the homepage"), "org fix unlocked by brand profile");
  assert.ok(body.includes("User-agent: PerplexityBot") && body.includes('"sameAs"'), "manual code shown");
  step("fixes page: manual mode with copy-paste code for a non-WordPress site");
  await a.fill("input[name=username]", "admin");
  await a.fill("input[name=appPassword]", "aaaa bbbb cccc dddd");
  await a.fill("input[name=siteUrl]", "http://localhost:3100");
  await a.click("button:has-text('Connect')");
  await a.waitForSelector("text=Blocked non-public address");
  assert.equal(await db.wpConnection.count(), 0);
  step("connecting WordPress to a private address is refused (SSRF guard holds in production)");
  const zipRes = await a.request.get(`${BASE}/api/plugin`);
  assert.equal(zipRes.headers()["content-type"], "application/zip");
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await zipRes.body());
  assert.ok(zip.file("visibility-connector/visibility-connector.php") && zip.file("visibility-connector/includes/robots.php"));
  step("plugin download is a valid zip with the plugin files");

  console.log("Schedules and alerts");
  await a.goto(`${BASE}/dashboard/visibility/${domain.id}`);
  await a.selectOption("select[name=auditSchedule]", "weekly");
  await a.click("button:has-text('Save schedule')");
  await waitFor(async () => (await db.domain.findUniqueOrThrow({ where: { id: domain.id } })).auditSchedule === "weekly", "schedule saved", 10_000);
  const next = (await db.domain.findUniqueOrThrow({ where: { id: domain.id } })).nextAuditAt!;
  assert.ok(Math.abs(next.getTime() - Date.now() - 7 * 86_400_000) < 120_000, "next audit in ~7 days");
  step("weekly audit schedule saves with the next run a week out");
  await db.alert.create({ data: { orgId: org.id, domainId: domain.id, kind: "visibility_drop", title: "ChatGPT stopped linking to you for “best mail”", detail: "Linked 5/5 → 0/5", link: `/dashboard/visibility/${domain.id}` } });
  await a.goto(`${BASE}/dashboard`);
  assert.equal((await a.locator("aside a[href='/dashboard/alerts'] span.bg-high").textContent())?.trim(), "1");
  await a.goto(`${BASE}/dashboard/alerts`);
  assert.ok((await text(a)).includes("ChatGPT stopped linking to you"));
  await a.click("button:has-text('Mark all read')");
  await waitFor(async () => (await db.alert.count({ where: { readAt: null } })) === 0, "alerts read", 10_000);
  await a.goto(`${BASE}/dashboard`);
  assert.equal(await a.locator("aside a[href='/dashboard/alerts'] span.bg-high").count(), 0);
  step("alert shows in the sidebar badge and alerts page, and mark-all-read clears it");

  console.log("Billing and plan limits");
  await a.goto(`${BASE}/dashboard/billing`);
  body = await text(a);
  assert.ok(body.includes("Trial plan") && body.includes("AI answers this month") && body.includes("Online payment isn't set up yet"));
  assert.equal(await a.locator("button:has-text('Choose Growth')").isDisabled(), true);
  step("billing page shows plan, usage meters, and disabled upgrades without Stripe");
  await a.goto(`${BASE}/dashboard/sites`);
  await a.fill("input[name=domain]", "example.org");
  await a.click("form:has(input[name=domain]) button");
  await a.waitForURL(/\/dashboard\/crawls\//);
  await a.goto(`${BASE}/dashboard/sites`);
  await a.fill("input[name=domain]", "example.net");
  await a.click("form:has(input[name=domain]) button");
  await a.waitForSelector("text=Your Trial plan includes 3 sites");
  assert.equal(await db.domain.count({ where: { orgId: org.id } }), 3);
  step("site limit enforced at the plan's 3 sites");

  console.log("Phase 3: accuracy, discovery, attribution, presence, judge");
  const tmp = path.resolve(".ui-test-tmp");
  fs.mkdirSync(tmp, { recursive: true });
  // Eight weekly runs with stored answers; mention rate rises week by week. The latest has a wrong price.
  const promptRow = await db.prompt.findFirstOrThrow({ where: { domainId: domain.id } });
  const monday = (weeksAgo: number) => {
    const d = new Date();
    d.setUTCHours(12, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * weeksAgo);
    return d;
  };
  for (let w = 8; w >= 1; w--) {
    const r = await db.visibilityRun.create({ data: { orgId: org.id, domainId: domain.id, engines: "chatgpt", trials: 4, status: "completed", createdAt: monday(w) } });
    const mentions = 9 - w; // 1..8 of 8
    await db.visibilityResult.createMany({
      data: Array.from({ length: 8 }, (_, i) => ({
        runId: r.id,
        promptId: promptRow.id,
        engine: "chatgpt",
        trial: i + 1,
        mentioned: i < mentions,
        answer: w === 1 && i === 0 ? "Acme Mail costs $39 a month. Rival Mail scans over 2 million letters a year for 40% less than a PO box." : "Some answer.",
        citedUrls: JSON.stringify([{ url: "https://www.g2.com/products/rival" }, { url: "https://www.techradar.com/best/mail" }]),
        createdAt: monday(w),
      })),
    });
  }

  await a.goto(`${BASE}/dashboard/truth/${domain.id}`);
  await a.fill("textarea[name=prices]", "Starter | 29 | USD");
  await a.fill("textarea[name=claims]", "We scan over 2 million letters a year for 40% less than a PO box");
  await a.fill("textarea[name=competitors]", "Rival Mail");
  await a.click("button:has-text('Save and re-check answers')");
  await waitFor(async () => (await db.factsRecord.count({ where: { domainId: domain.id } })) === 1, "facts saved", 15_000).catch(async () => assert.fail(`facts not saved: ${(await text(a)).slice(0, 1500)}`));
  await a.waitForSelector("text=Wrong prices");
  body = await text(a);
  assert.ok(body.includes("Acme Mail costs $39 a month.") && body.includes("Your claims credited to others"), body.slice(body.indexOf("Findings"), body.indexOf("Findings") + 600));
  step("accuracy monitor: facts saved, latest stored answers re-checked, wrong price and stolen claim shown");

  const gscQueries = path.join(tmp, "Queries.csv");
  fs.writeFileSync(gscQueries, 'Top queries,Clicks,Impressions,CTR,Position\n"best virtual mailbox for travelers",3,"2,400",0.1%,9.1\nacme mail login,30,90,33%,1\n');
  await a.goto(`${BASE}/dashboard/visibility/${domain.id}`);
  await a.click("summary:has-text('Import Search Console queries')");
  await a.setInputFiles("input[aria-label='Search Console Queries CSV']", gscQueries);
  await a.click("button:has-text('Import queries')");
  await a.waitForSelector("text=best virtual mailbox for travelers");
  assert.ok(!(await text(a)).includes("acme mail login"), "branded query not suggested");
  const before = await db.prompt.count({ where: { domainId: domain.id } });
  await a.click(`button[aria-label='Track "best virtual mailbox for travelers"']`);
  await waitFor(async () => (await db.prompt.count({ where: { domainId: domain.id } })) === before + 1, "suggestion tracked", 10_000);
  step("Search Console import suggests non-branded questions; Track adds one");

  const dates = path.join(tmp, "Dates.csv");
  const rows = ["Date,Clicks,Impressions,CTR,Position"];
  for (let w = 8; w >= 1; w--) for (let d = 0; d < 7; d++) {
    const day = monday(w);
    day.setUTCDate(day.getUTCDate() + d);
    rows.push(`${day.toISOString().slice(0, 10)},${10 + (9 - w) * 3},${200},1%,3`);
  }
  fs.writeFileSync(dates, rows.join("\n"));
  await a.goto(`${BASE}/dashboard/attribution/${domain.id}`);
  await a.selectOption("select[name=source]", "gsc_branded");
  await a.setInputFiles("input[aria-label='Daily performance CSV']", dates);
  await a.click("button:has-text('Import')");
  await a.waitForSelector("text=rose and fell with AI mentions the same week");
  body = await text(a);
  assert.ok(body.includes("Across 8 weeks") && body.includes("Correlation doesn't show"));
  assert.equal(await a.locator("figure svg").count(), 2, "two small-multiple charts, no dual axis");
  await a.screenshot({ path: path.join(tmp, "attribution.png"), fullPage: true });
  step("attribution: Dates.csv import, two aligned charts, honest correlation statement");

  await a.goto(`${BASE}/dashboard/presence/${domain.id}`);
  body = await text(a);
  assert.ok(/high\s*G2/.test(body) && body.includes("techradar.com"));
  step("presence: G2 ranked high from AI citations, techradar listed as a publication");

  await a.goto(`${BASE}/dashboard/crawls/${crawlId}`);
  assert.ok((await text(a)).includes("AI extractability check (beta)"));
  assert.equal(await a.locator("button:has-text('Run AI extractability check')").isDisabled(), true);
  assert.equal(await db.judgeRun.count(), 0);
  step("extractability judge stays disabled without an API key and nothing runs");

  console.log("Phase 4: agency, white-label, API, staff, rate limits");
  const ctxG = await browser.newContext();
  const g = await ctxG.newPage();
  g.on("pageerror", (e) => pageErrors.push(e.message));
  await g.goto(`${BASE}/signup`);
  await g.fill("input[name=name]", "Gina");
  await g.fill("input[name=company]", "Northwind Agency");
  await g.fill("input[name=email]", "gina@northwind.example");
  await g.fill("input[name=password]", "password1234");
  await g.check("input[name=agency]");
  await g.click("form button");
  await g.waitForURL(/\/dashboard/);
  await g.goto(`${BASE}/dashboard/clients`);
  for (const name of ["Acme Bakery", "Bolt Bikes"]) {
    await g.fill("input[name=name]", name);
    await g.click("button:has-text('Add client')");
    await g.waitForSelector(`td:has-text('${name}')`);
  }
  await g.fill("input[name=name]", "Third Client");
  await g.click("button:has-text('Add client')");
  await g.waitForSelector("text=includes 2 client workspaces");
  step("agency sign-up, two client workspaces, trial limit blocks a third");

  await g.goto(`${BASE}/dashboard/branding`);
  await g.fill("input[name=brandName]", "Northwind SEO");
  await g.fill("input[name=brandColor]", "javascript:red");
  await g.click("button:has-text('Save branding')");
  await g.waitForSelector("text=Colour must look like");
  assert.equal(await g.inputValue("input[name=brandName]"), "Northwind SEO", "typed values survive a failed save");
  assert.equal(await g.inputValue("input[name=brandColor]"), "javascript:red");
  await g.fill("input[name=brandColor]", "#1f3a93");
  await g.fill("textarea[name=reportFooter]", "Prepared by Northwind SEO");
  await g.click("button:has-text('Save branding')");
  await waitFor(async () => (await db.organization.findFirst({ where: { name: "Northwind Agency" } }))?.brandName === "Northwind SEO", "brand saved", 10_000);
  step("branding validates colours, keeps what was typed on error, and saves");

  await g.goto(`${BASE}/dashboard/clients`);
  await g.click("tr:has-text('Acme Bakery') button:has-text('Open')");
  await g.waitForSelector("text=Client workspace: Acme Bakery");
  body = await text(g);
  assert.ok(body.includes("Northwind SEO"), "client workspace shows the agency brand");
  assert.ok(!body.includes("Visibility\n"), "product name replaced in the sidebar");
  const highlight = await g.evaluate(() => getComputedStyle(document.querySelector("div.min-h-screen")!).getPropertyValue("--highlight").trim());
  assert.equal(highlight, "#1f3a93");
  step("client workspace: agency banner, agency brand and accent colour");
  await g.click("button:has-text('Back to all clients')");
  await g.waitForSelector("text=Add a client");
  step("back to the agency from a client workspace");

  // Alice (standard org) must not be able to switch into Northwind's client.
  const acme = await db.organization.findFirstOrThrow({ where: { name: "Acme Bakery" } });
  assert.equal((await a.goto(`${BASE}/dashboard/clients`))?.status(), 404, "a standard workspace has no client console");
  const { resolveAccess } = await import("@/lib/access");
  const aliceUser = await db.user.findFirstOrThrow({ where: { email: "alice@example.com" } });
  assert.equal(await resolveAccess(aliceUser.id, acme.id), null);
  step("other customers have no access to an agency's client workspaces");

  await g.goto(`${BASE}/dashboard/api`);
  assert.ok((await text(g)).includes("API access is included in the Advanced and Agency plans"));
  assert.equal(await g.locator("button:has-text('Create key')").isDisabled(), true);
  await db.organization.updateMany({ where: { name: "Northwind Agency" }, data: { plan: "agency" } });
  await g.goto(`${BASE}/dashboard/api`);
  await g.fill("input[name=name]", "Looker");
  await g.click("button:has-text('Create key')");
  await g.waitForSelector("text=Copy it now");
  const key = (await g.locator("pre code").first().textContent())!.trim();
  assert.match(key, /^vis_/);
  const apiRes = await fetch(`${BASE}/api/v1/clients`, { headers: { authorization: `Bearer ${key}` } });
  assert.equal(apiRes.status, 200);
  assert.deepEqual(((await apiRes.json()) as { data: { name: string }[] }).data.map((c) => c.name), ["Acme Bakery", "Bolt Bikes"]);
  const viaClient = await fetch(`${BASE}/api/v1/sites`, { headers: { authorization: `Bearer ${key}`, "x-workspace": acme.id } });
  assert.equal(viaClient.status, 200);
  const crossOrg = await fetch(`${BASE}/api/v1/sites/${domain.id}/audit`, { headers: { authorization: `Bearer ${key}` } });
  assert.equal(crossOrg.status, 404);
  await g.click("button:has-text('Revoke')");
  await waitFor(async () => (await fetch(`${BASE}/api/v1/clients`, { headers: { authorization: `Bearer ${key}` } })).status === 401, "revoked key rejected", 10_000);
  step("API: plan-gated keys, shown once, agency client access, cross-org 404, revoke");

  const staffOutsider = await g.goto(`${BASE}/staff`);
  assert.equal(staffOutsider?.status(), 404);
  const ctxS = await browser.newContext();
  const st = await ctxS.newPage();
  await st.goto(`${BASE}/signup`);
  await st.fill("input[name=name]", "Sam Staff");
  await st.fill("input[name=company]", "Visibility Inc");
  await st.fill("input[name=email]", "staff@example.com");
  await st.fill("input[name=password]", "password1234");
  await st.click("form button");
  await st.waitForURL(/\/dashboard/);
  await st.goto(`${BASE}/staff`);
  body = await text(st);
  assert.ok(body.includes("Northwind Agency") && body.includes("Acme Bakery") && body.includes("Alice Co"));
  await st.click("a:has-text('Northwind Agency')");
  await st.fill("textarea[name=body]", "Onboarding call booked for Tuesday.");
  await st.click("button:has-text('Add note')");
  await st.waitForSelector("text=Onboarding call booked for Tuesday.");
  step("staff console: 404 for customers, full overview and notes for staff");
  await ctxS.close();

  const lp = await ctxG.newPage();
  for (let i = 0; i < 11; i++) {
    await lp.goto(`${BASE}/login`);
    await lp.fill("input[name=email]", "victim@example.com");
    await lp.fill("input[name=password]", `wrong-guess-${i}`);
    await lp.click("form button");
    await lp.waitForSelector("p[role=alert], text=Email or password is incorrect, text=Too many login attempts").catch(() => {});
  }
  await lp.waitForSelector("text=Too many login attempts");
  step("login rate limit kicks in after 10 attempts for one account");
  await ctxG.close();

  console.log("Phone width");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctxA.storageState() });
  const m = await phone.newPage();
  const overflowing: string[] = [];
  for (const path of ["/dashboard", "/dashboard/sites", `/dashboard/crawls/${crawlId}`, `/dashboard/crawls/${crawlId}/report`, "/dashboard/visibility", `/dashboard/visibility/${domain.id}`, `/dashboard/entity/${domain.id}`, `/dashboard/fixes/${domain.id}`, `/dashboard/truth/${domain.id}`, `/dashboard/attribution/${domain.id}`, `/dashboard/presence/${domain.id}`, "/dashboard/alerts", "/dashboard/costs", "/dashboard/billing", "/dashboard/api"]) {
    await m.goto(`${BASE}${path}`);
    const w = await m.evaluate(() => document.documentElement.scrollWidth);
    if (w > 390) overflowing.push(`${path} (${w}px)`);
  }
  assert.deepEqual(overflowing, [], "pages scroll sideways on a phone");
  await phone.close();
  step("no page scrolls sideways at phone width (390px)");

  console.log("Tenant isolation");
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await signup(b, "Bob", "bob@example.com");
  await b.waitForURL(/\/dashboard/);
  for (const path of [`/dashboard/crawls/${crawlId}`, `/dashboard/crawls/${crawlId}/report`, `/dashboard/visibility/${domain.id}`, `/dashboard/entity/${domain.id}`, `/dashboard/fixes/${domain.id}`, `/dashboard/truth/${domain.id}`, `/dashboard/attribution/${domain.id}`, `/dashboard/presence/${domain.id}`]) {
    const res = await b.goto(`${BASE}${path}`);
    assert.equal(res?.status(), 404, `Bob could open Alice's ${path}`);
  }
  step("another organisation gets 404 on crawl, report, visibility, brand profile and fixes pages");
  await b.goto(`${BASE}/dashboard/sites`);
  assert.ok(!(await text(b)).includes("localhost") && !(await text(b)).includes("example.com"));
  await b.goto(`${BASE}/dashboard/costs`);
  assert.ok(!(await text(b)).includes("ChatGPT"));
  await b.goto(`${BASE}/dashboard/alerts`);
  assert.ok((await text(b)).includes("No alerts yet"));
  step("sites and costs lists contain no other organisation's data");
  assert.equal(await db.membership.count({ where: { user: { email: "bob@example.com" } } }), 1, "Bob belongs only to his own workspace");

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
  for (const p of procs) {
    try {
      if (p.pid) process.kill(-p.pid, "SIGKILL");
    } catch {}
  }
  fs.rmSync("ui-test.db", { force: true });
  fs.rmSync(".ui-test-tmp/Queries.csv", { force: true });
  fs.rmSync(".ui-test-tmp/Dates.csv", { force: true });
  process.exit(code);
}
