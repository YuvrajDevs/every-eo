// Hostile tests against the production build: an outsider and a logged-in attacker ("Mallory") try to reach or
// change another customer's ("Victor's") data. Run: npm run build && npm run test:attack
import { spawn, execSync, type ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { chromium, type Page, type Request as PwRequest } from "playwright-core";
import { SignJWT } from "jose";

const PORT = 3102;
const BASE = `http://localhost:${PORT}`;
const SECRET = "attack-test-secret-attack-test-secret-99";
process.env.DATABASE_URL = "file:./attack-test.db";
process.env.SESSION_SECRET = SECRET;
const env = {
  ...process.env,
  NODE_ENV: "production" as const,
  APP_URL: BASE,
  STAFF_EMAILS: "staff@victor.example",
  STRIPE_WEBHOOK_SECRET: "whsec_attack",
  SHOPIFY_API_KEY: "k",
  SHOPIFY_API_SECRET: "shopify_attack",
};
const procs: ChildProcess[] = [];
let passed = 0;
const step = (s: string) => {
  console.log(`  ✓ ${s}`);
  passed++;
};

async function main() {
  fs.rmSync("attack-test.db", { force: true });
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  procs.push(spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: "ignore", detached: true }));
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/login`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const { db } = await import("@/lib/db");
  const { encrypt } = await import("@/lib/secrets");
  const { createApiKey } = await import("@/lib/api");

  // ---- Seed two customers with the same shape of data.
  async function seedCustomer(tag: string, plan: string) {
    const org = await db.organization.create({ data: { name: `${tag} Co`, plan, kind: "agency" } });
    const client = await db.organization.create({ data: { name: `${tag} Client`, kind: "client", parentId: org.id } });
    const domain = await db.domain.create({ data: { orgId: org.id, hostname: `${tag.toLowerCase()}.example`, brandName: tag } });
    const prompt = await db.prompt.create({ data: { domainId: domain.id, text: `best ${tag} thing?` } });
    const crawl = await db.crawl.create({ data: { orgId: org.id, domainId: domain.id, status: "completed", finishedAt: new Date() } });
    await db.page.create({ data: { crawlId: crawl.id, url: `https://${tag.toLowerCase()}.example/`, statusCode: 200, wordCount: 500, title: "Home", h1: "Home" } });
    await db.finding.create({ data: { crawlId: crawl.id, layer: "geo", code: "bot_blocked_perplexitybot", severity: "high", evidence: "proven", title: "Blocked", detail: "d" } });
    await db.entityRecord.create({ data: { domainId: domain.id, data: JSON.stringify({ name: tag, url: `https://${tag.toLowerCase()}.example`, sameAs: [], authors: [] }) } });
    await db.factsRecord.create({ data: { domainId: domain.id, data: JSON.stringify({ prices: [], discontinued: [], competitors: [], claims: [] }) } });
    await db.wpConnection.create({ data: { domainId: domain.id, siteUrl: `https://${tag.toLowerCase()}.example`, username: "admin", secret: encrypt("aaaa bbbb") } });
    const fix = await db.fix.create({ data: { orgId: org.id, domainId: domain.id, key: "robots-allow", type: "robots_allow", findingCode: "bot_blocked_perplexitybot", title: "Allow", payload: "{}", status: "verified", appliedAt: new Date() } });
    const { key, row } = await createApiKey(org.id, `${tag} key`);
    await db.alert.create({ data: { orgId: org.id, domainId: domain.id, kind: "new_issue", title: `${tag} alert`, detail: "d" } });
    return { org, client, domain, prompt, crawl, fix, apiKey: key, keyRow: row };
  }
  const victor = await seedCustomer("Victor", "agency");
  const mallory = await seedCustomer("Mallory", "agency");

  // Victor's data as one comparable snapshot; it must never change because of anything Mallory does.
  const snapshot = async () =>
    JSON.stringify(
      await db.organization.findMany({
        where: { OR: [{ id: victor.org.id }, { parentId: victor.org.id }] },
        orderBy: { id: "asc" },
        include: {
          domains: { include: { prompts: true, entity: true, facts: true, wordpress: true, fixes: true, crawls: { include: { judgeRuns: true } }, gscQueries: true, searchDays: true } },
          apiKeys: true,
          alerts: true,
          staffNotes: true,
          memberships: true,
          jobs: true,
        },
      }),
    );
  const victorUser = await db.user.create({ data: { email: "victor@victor.example", name: "Victor", passwordHash: "x" } });
  await db.membership.create({ data: { userId: victorUser.id, orgId: victor.org.id } });
  const victorBefore = await snapshot();

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.66" } });
  const m = await ctx.newPage();
  const dialogs: string[] = [];
  m.on("dialog", async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });

  // Mallory signs up, then joins her seeded agency workspace (stands in for being that workspace's owner).
  await m.goto(`${BASE}/signup`);
  await m.fill("input[name=name]", "Mallory");
  await m.fill("input[name=company]", "scratch");
  await m.fill("input[name=email]", "mallory@evil.example");
  await m.fill("input[name=password]", "password1234");
  await m.click("form button");
  await m.waitForURL(/\/dashboard/);
  const malloryUser = await db.user.findFirstOrThrow({ where: { email: "mallory@evil.example" } });
  await db.membership.create({ data: { userId: malloryUser.id, orgId: mallory.org.id, role: "owner" } });
  // Switch into her seeded workspace by re-logging (first membership is "scratch"; promote the seeded one).
  await db.membership.deleteMany({ where: { userId: malloryUser.id, orgId: { not: mallory.org.id } } });
  await ctx.clearCookies();
  await m.goto(`${BASE}/login`);
  await m.fill("input[name=email]", "mallory@evil.example");
  await m.fill("input[name=password]", "password1234");
  await m.click("form button");
  await m.waitForURL(/\/dashboard/);

  console.log("Unauthenticated access");
  const manifest = JSON.parse(fs.readFileSync(".next/app-path-routes-manifest.json", "utf8")) as Record<string, string>;
  const routes = [...new Set(Object.values(manifest))].filter((r) => !r.startsWith("/_"));
  const fill = (r: string) =>
    r
      .replace("[domainId]", victor.domain.id)
      .replace("[orgId]", victor.org.id)
      .replace("[id]", r.startsWith("/api/v1/sites") ? victor.domain.id : victor.crawl.id);
  const PUBLIC = new Set(["/", "/login", "/signup", "/verify", "/api/plugin", "/favicon.ico"]);
  const leaks: string[] = [];
  for (const r of routes) {
    const url = `${BASE}${fill(r)}`;
    for (const method of ["GET", "POST"]) {
      const res = await fetch(url, { method, redirect: "manual", headers: { "x-forwarded-for": "198.51.100.200" } });
      const body = await res.text();
      const ok = res.status === 200 && !PUBLIC.has(r);
      if (ok || body.includes("Victor")) leaks.push(`${method} ${r} → ${res.status}`);
    }
  }
  assert.deepEqual(leaks, [], `routes that answered without login: ${leaks.join(", ")}`);
  step(`all ${routes.length} routes: no data and no 200 without login (pages redirect, APIs refuse)`);

  console.log("Forged and replayed sessions");
  const key = new TextEncoder().encode(SECRET);
  const asCookie = async (cookie: string) => (await fetch(`${BASE}/dashboard`, { redirect: "manual", headers: { cookie: `session=${cookie}` } })).status;
  const forgedNoSid = await new SignJWT({ userId: victorUser.id, orgId: victor.org.id }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(key);
  const forgedFakeSid = await new SignJWT({ userId: victorUser.id, orgId: victor.org.id, sid: "made-up" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(key);
  const wrongKey = await new SignJWT({ userId: victorUser.id, orgId: victor.org.id, sid: "x" }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode("x".repeat(40)));
  const algNone = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ userId: victorUser.id, orgId: victor.org.id, sid: "x" })).toString("base64url")}.`;
  for (const c of [forgedNoSid, forgedFakeSid, wrongKey, algNone, "garbage"]) assert.notEqual(await asCookie(c), 200);
  const malloryCookie = (await ctx.cookies()).find((c) => c.name === "session")!.value;
  // Mallory's own valid session, but pointed at Victor's workspace by editing the payload: signature breaks.
  const [h, p, s] = malloryCookie.split(".");
  const tampered = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), orgId: victor.org.id })).toString("base64url")}.${s}`;
  assert.notEqual(await asCookie(tampered), 200);
  step("forged, unsigned (alg none), wrong-key, missing-session and tampered cookies are all rejected");

  console.log("Capture Mallory's own actions, then replay them against Victor's IDs");
  const captured: { url: string; action: string; body: string; contentType: string; label: string }[] = [];
  let label = "";
  const onReq = (r: PwRequest) => {
    const action = r.headers()["next-action"];
    if (r.method() === "POST" && action) captured.push({ url: r.url(), action, body: r.postData() ?? "", contentType: r.headers()["content-type"] ?? "", label });
  };
  m.on("request", onReq);
  const act = async (l: string, fn: () => Promise<unknown>) => {
    label = l;
    await fn();
    await m.waitForTimeout(600);
  };
  const vis = `${BASE}/dashboard/visibility/${mallory.domain.id}`;
  await act("addPrompt", async () => {
    await m.goto(vis);
    await m.fill("input[name=text]", "what is mallory doing here?");
    await m.click("form:has(input[name=text]) button");
  });
  await act("setBrandName", async () => {
    await m.fill("input[name=brandName]", "Mallory brand");
    await m.click("form:has(input[name=brandName]) button");
  });
  await act("setCategory", async () => {
    await m.fill("input[name=category]", "evil things");
    await m.click("form:has(input[name=category]) button");
  });
  await act("setSchedules", async () => m.click("button:has-text('Save schedule')"));
  await act("deletePrompt", async () => {
    await m.goto(vis);
    await m.click("button[title=Remove] >> nth=0");
  });
  await act("saveEntity", async () => {
    await m.goto(`${BASE}/dashboard/entity/${mallory.domain.id}`);
    await m.click("button:has-text('Save and generate')");
  });
  await act("saveFacts", async () => {
    await m.goto(`${BASE}/dashboard/truth/${mallory.domain.id}`);
    await m.click("button:has-text('Save and re-check answers')");
  });
  await act("recheckFix+rollback", async () => {
    await m.goto(`${BASE}/dashboard/fixes/${mallory.domain.id}`);
    await m.click("button:has-text('Check again')");
    await m.waitForTimeout(800);
    await m.click("button:has-text('Roll back')").catch(() => {});
  });
  await act("disconnectWp", async () => {
    await m.goto(`${BASE}/dashboard/fixes/${mallory.domain.id}`);
    await m.click("button:has-text('Disconnect')").catch(() => {});
  });
  await act("recrawl", async () => {
    await m.goto(`${BASE}/dashboard/crawls/${mallory.crawl.id}`);
    await m.click("button:has-text('Run again')");
  });
  await act("revokeKey", async () => {
    await m.goto(`${BASE}/dashboard/api`);
    await m.click("button:has-text('Revoke') >> nth=0");
  });
  await act("switchWorkspace", async () => {
    await m.goto(`${BASE}/dashboard/clients`);
    await m.click("button:has-text('Open') >> nth=0");
  });
  m.off("request", onReq);
  const labels = [...new Set(captured.map((c) => c.label))];
  assert.ok(labels.length >= 10, `captured actions: ${labels.join(", ")}`);

  // Replace every one of Mallory's IDs with Victor's equivalent and send it again with Mallory's cookie.
  const swaps: [string, string][] = [
    [mallory.domain.id, victor.domain.id],
    [mallory.crawl.id, victor.crawl.id],
    [mallory.fix.id, victor.fix.id],
    [mallory.keyRow.id, victor.keyRow.id],
    [mallory.prompt.id, victor.prompt.id],
    [mallory.client.id, victor.client.id],
    [mallory.org.id, victor.org.id],
  ];
  const cookieHeader = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  let replayed = 0;
  for (const c of captured) {
    let body = c.body;
    for (const [from, to] of swaps) body = body.split(from).join(to);
    if (body === c.body) continue;
    replayed++;
    await fetch(c.url.split(mallory.domain.id).join(victor.domain.id), {
      method: "POST",
      headers: { "next-action": c.action, "content-type": c.contentType, cookie: cookieHeader, origin: BASE, "x-forwarded-for": "203.0.113.66", accept: "text/x-component" },
      body,
    });
  }
  assert.ok(replayed >= 8, `replayed ${replayed} actions`);
  assert.equal(await snapshot(), victorBefore, "Victor's data changed after replaying Mallory's actions with his IDs");
  step(`${replayed} captured server actions replayed with Victor's IDs (${labels.join(", ")}): Victor's data unchanged`);

  console.log("Cross-site request forgery");
  const one = captured.find((c) => c.label === "setBrandName")!;
  const csrf = await fetch(one.url, { method: "POST", headers: { "next-action": one.action, "content-type": one.contentType, cookie: cookieHeader, origin: "https://evil.example", "x-forwarded-for": "203.0.113.67" }, body: one.body.replace("Mallory brand", "CSRF brand") });
  assert.notEqual((await db.domain.findUniqueOrThrow({ where: { id: mallory.domain.id } })).brandName, "CSRF brand");
  step(`a server action posted from another origin is rejected (HTTP ${csrf.status})`);

  console.log("Stored script injection");
  await db.domain.update({ where: { id: mallory.domain.id }, data: { brandName: `<img src=x onerror=alert('xss-brand')>`, category: `"><script>alert('xss-cat')</script>` } });
  await db.prompt.create({ data: { domainId: mallory.domain.id, text: `<script>alert('xss-prompt')</script>` } });
  await db.alert.create({ data: { orgId: mallory.org.id, domainId: mallory.domain.id, kind: "new_issue", title: `<svg onload=alert('xss-alert')>`, detail: "<iframe src=javascript:alert('xss-iframe')>" } });
  await db.finding.create({ data: { crawlId: mallory.crawl.id, layer: "seo", code: "x", severity: "low", evidence: "proven", title: `<img src=x onerror=alert('xss-finding')>`, detail: "<script>alert('xss-detail')</script>", url: "javascript:alert('xss-url')" } });
  await db.organization.update({ where: { id: mallory.org.id }, data: { brandName: `</title><script>alert('xss-org')</script>`, reportFooter: `<script>alert('xss-footer')</script>`, brandLogoUrl: "https://x.example/a.png\" onerror=\"alert('xss-logo')" } });
  for (const path of [vis, `${BASE}/dashboard/alerts`, `${BASE}/dashboard/crawls/${mallory.crawl.id}`, `${BASE}/dashboard/crawls/${mallory.crawl.id}/report`, `${BASE}/dashboard/clients`, `${BASE}/dashboard/branding`]) {
    await m.goto(path);
    await m.waitForTimeout(300);
    const links = await m.$$eval("a[href^='javascript:']", (as) => as.length);
    assert.equal(links, 0, `javascript: link rendered on ${path}`);
  }
  assert.deepEqual(dialogs, [], `script ran: ${dialogs.join(", ")}`);
  step("script payloads in brand, prompts, alerts, findings, branding and report footer never execute; javascript: URLs aren't rendered as links");

  console.log("Security headers");
  const res = await fetch(`${BASE}/login`);
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(res.headers.get("strict-transport-security"));
  assert.equal(res.headers.get("x-powered-by"), null);
  const set = (await fetch(`${BASE}/login`)).headers.get("content-security-policy");
  assert.notEqual(set, csp, "nonce is fresh per request");
  step("CSP with per-request nonce, frame blocking, nosniff, HSTS; no X-Powered-By");

  console.log("Rate limits");
  let limited = 0;
  for (let i = 0; i < 25; i++) {
    const r = await fetch(`${BASE}/login`, { method: "POST", headers: { "x-forwarded-for": "198.51.100.77", "content-type": "text/plain" }, body: "x" });
    if (r.status === 429) limited++;
  }
  assert.ok(limited >= 5, `login POST flood: ${limited} limited`);
  let spoofLimited = 0;
  for (let i = 0; i < 25; i++) {
    // Rotating the left-most X-Forwarded-For entry doesn't help: only the proxy-added (right-most) one counts.
    const r = await fetch(`${BASE}/login`, { method: "POST", headers: { "x-forwarded-for": `10.9.9.${i}, 198.51.100.78`, "content-type": "text/plain" }, body: "x" });
    if (r.status === 429) spoofLimited++;
  }
  assert.ok(spoofLimited >= 5, "spoofed X-Forwarded-For bypassed the limit");
  const floodKey = (await createApiKey(mallory.org.id, "flood")).key;
  let apiLimited = 0;
  for (let i = 0; i < 130; i++) {
    const r = await fetch(`${BASE}/api/v1/sites`, { headers: { authorization: `Bearer ${floodKey}`, "x-forwarded-for": `198.51.100.${100 + (i % 50)}` } });
    if (r.status === 429) apiLimited++;
  }
  assert.ok(apiLimited >= 5, "API key flood across many IPs not limited");
  let pluginLimited = 0;
  for (let i = 0; i < 25; i++) if ((await fetch(`${BASE}/api/plugin`, { headers: { "x-forwarded-for": "198.51.100.90" } })).status === 429) pluginLimited++;
  assert.ok(pluginLimited >= 3);
  step("login, API key, and plugin download floods hit 429; spoofed X-Forwarded-For doesn't bypass it");

  console.log("Webhooks and integrations");
  const stripeBody = JSON.stringify({ id: "evt_forged", type: "customer.subscription.updated", data: { object: { id: "sub", customer: "cus", status: "active", metadata: { orgId: mallory.org.id }, items: { data: [{ price: { id: "anything" } }] } } } });
  assert.equal((await fetch(`${BASE}/api/stripe/webhook`, { method: "POST", body: stripeBody, headers: { "stripe-signature": "t=1,v1=00" } })).status, 400);
  const old = Math.floor(Date.now() / 1000) - 3600;
  const replay = `t=${old},v1=${createHmac("sha256", "whsec_attack").update(`${old}.${stripeBody}`).digest("hex")}`;
  assert.equal((await fetch(`${BASE}/api/stripe/webhook`, { method: "POST", body: stripeBody, headers: { "stripe-signature": replay } })).status, 400, "old signed event replayed");
  assert.equal((await fetch(`${BASE}/api/shopify/webhooks`, { method: "POST", body: "{}", headers: { "x-shopify-hmac-sha256": "AAAA", "x-shopify-topic": "app/uninstalled", "x-shopify-shop-domain": "victor.myshopify.com" } })).status, 401);
  const evilShop = await fetch(`${BASE}/api/shopify/install?domainId=${mallory.domain.id}&shop=evil.example`, { redirect: "manual", headers: { cookie: cookieHeader, "x-forwarded-for": "203.0.113.68" } });
  assert.ok(!(evilShop.headers.get("location") ?? "").includes("evil.example"), "install redirected to a non-Shopify host");
  const crossInstall = await fetch(`${BASE}/api/shopify/install?domainId=${victor.domain.id}&shop=victor.myshopify.com`, { redirect: "manual", headers: { cookie: cookieHeader, "x-forwarded-for": "203.0.113.68" } });
  assert.equal(crossInstall.status, 404, "Mallory started a Shopify install for Victor's site");
  assert.equal((await db.organization.findUniqueOrThrow({ where: { id: mallory.org.id } })).planStatus, null);
  step("forged and replayed Stripe events, forged Shopify webhooks, non-Shopify and cross-tenant installs are refused");

  console.log("API abuse");
  const malloryKey = (await createApiKey(mallory.org.id, "fresh")).key; // her first key was revoked above
  const api = (path: string, k = malloryKey, extra: Record<string, string> = {}) => fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${k}`, "x-forwarded-for": "198.51.100.150", ...extra } });
  for (const id of [victor.domain.id, "../../etc/passwd", "' OR 1=1 --", "%00", "x".repeat(5000)]) {
    const r = await api(`/api/v1/sites/${encodeURIComponent(id)}/audit`);
    assert.ok([404, 414, 431, 400].includes(r.status), `id ${id.slice(0, 20)} → ${r.status}`);
  }
  assert.equal((await api("/api/v1/sites", malloryKey, { "x-workspace": victor.client.id })).status, 404);
  assert.equal((await api("/api/v1/sites", malloryKey, { "x-workspace": victor.org.id })).status, 404);
  assert.equal((await api("/api/v1/sites", mallory.apiKey)).status, 401, "revoked key");
  assert.equal((await api("/api/v1/sites", `${victor.apiKey.slice(0, -2)}xx`)).status, 401);
  step("API: other tenants' sites, injection/traversal IDs, other workspaces via X-Workspace and near-miss keys all refused");

  console.log("Staff console");
  assert.equal((await m.goto(`${BASE}/staff`))?.status(), 404);
  const staff = await db.user.create({ data: { email: "staff@victor.example", name: "Staff", passwordHash: (await import("bcryptjs")).default.hashSync("password1234", 12) } });
  const staffOrg = await db.organization.create({ data: { name: "Our team" } });
  await db.membership.create({ data: { userId: staff.id, orgId: staffOrg.id } });
  const sctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.70" } });
  const sp = await sctx.newPage();
  await sp.goto(`${BASE}/login`);
  await sp.fill("input[name=email]", "staff@victor.example");
  await sp.fill("input[name=password]", "password1234");
  await sp.click("form button");
  await sp.waitForURL(/\/dashboard/);
  assert.equal((await sp.goto(`${BASE}/staff`))?.status(), 404, "unverified staff email got in");
  step("staff console: 404 for customers and for a listed but unverified staff email");

  console.log("Logout revokes the session server-side");
  const before = (await ctx.cookies()).find((c) => c.name === "session")!.value;
  await m.goto(`${BASE}/dashboard`);
  await m.click("button[aria-label='Log out'] >> visible=true");
  await m.waitForURL(/\/login/);
  assert.notEqual(await asCookie(before), 200, "old cookie still worked after logout");
  step("a session cookie copied before logout stops working after logout");

  console.log("Oversized requests");
  const huge = await fetch(`${BASE}/login`, { method: "POST", headers: { "content-type": "text/plain", "x-forwarded-for": "198.51.100.210" }, body: "x".repeat(8 * 1024 * 1024) });
  assert.notEqual(huge.status, 200);
  step(`an 8 MB request body is refused (HTTP ${huge.status})`);

  assert.equal(await snapshot(), victorBefore, "Victor's data changed during the run");
  step("Victor's data is byte-for-byte unchanged after the whole run");
  await browser.close();
  console.log(`\n${passed} attack checks passed`);
}

function cleanup(code: number) {
  for (const p of procs) {
    try {
      if (p.pid) process.kill(-p.pid, "SIGKILL");
    } catch {}
  }
  fs.rmSync("attack-test.db", { force: true });
  process.exit(code);
}

main()
  .then(() => cleanup(0))
  .catch((e) => {
    console.error("\nFAILED:", e);
    cleanup(1);
  });
