import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { startFixture } from "./fixture";

// Environment must be set before the database module loads.
process.env.AUDIT_TEST_ALLOW_PRIVATE = "1";
process.env.DATABASE_URL = "file:./test.db";
process.env.OPENAI_API_KEY = "test-key";
process.env.PSI_API_KEY = "";

let server: http.Server;

before(async () => {
  fs.rmSync("test.db", { force: true });
  const { execSync } = await import("node:child_process");
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
  server = await startFixture();
});

after(async () => {
  server?.close();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
  fs.rmSync("test.db", { force: true });
});

async function seed() {
  const { db } = await import("@/lib/db");
  const org = await db.organization.create({ data: { name: "Test Org" } });
  const domain = await db.domain.create({ data: { orgId: org.id, hostname: "localhost", brandName: "Acme" } });
  return { db, org, domain };
}

test("full audit finds the planted problems and nothing false on the clean parts", async () => {
  const { db, org, domain } = await seed();
  const crawl = await db.crawl.create({ data: { orgId: org.id, domainId: domain.id } });
  const { runCrawl } = await import("@/worker/crawl");
  await runCrawl(crawl.id);

  const done = await db.crawl.findUniqueOrThrow({ where: { id: crawl.id }, include: { findings: true, pages: true, robots: true } });
  assert.equal(done.status, "completed");
  const codes = new Set(done.findings.map((f) => f.code));
  const byCode = (c: string) => done.findings.filter((f) => f.code === c);

  // Crawler access: robots.txt blocks PerplexityBot (search) and GPTBot (training), firewall rejects OAI-SearchBot.
  assert.ok(codes.has("bot_blocked_perplexitybot"), "search bot blocked in robots.txt");
  assert.equal(byCode("bot_blocked_perplexitybot")[0].evidence, "proven");
  assert.equal(byCode("bot_blocked_perplexitybot")[0].severity, "high");
  assert.ok(codes.has("bot_training_optout_gptbot"), "training opt-out reported");
  assert.equal(byCode("bot_training_optout_gptbot")[0].severity, "info", "training block is not a problem");
  assert.ok(codes.has("firewall_blocks_oai-searchbot"), "firewall-level block caught by live fetch");
  assert.ok(!codes.has("bot_blocked_oai-searchbot"), "robots.txt allows OAI-SearchBot");
  const perplexity = JSON.parse(done.robots!.botAccess).find((b: { userAgent: string }) => b.userAgent === "OAI-SearchBot");
  assert.equal(perplexity.reachable, false);

  // Technical SEO.
  assert.ok(codes.has("http_error"), "linked 404 page");
  assert.ok(codes.has("missing_title"));
  assert.ok(codes.has("missing_meta_description"));
  assert.ok(codes.has("multiple_h1"));
  assert.ok(codes.has("orphan_pages"), "sitemap page nothing links to");
  assert.ok(!codes.has("no_sitemap"));
  // The fixture lives on localhost, so the sitemap pointing at localhost is correctly flagged as unreachable.
  assert.ok(codes.has("sitemap_wrong_host"));

  // Schema.
  assert.ok(codes.has("organization_no_sameas"));
  assert.ok(codes.has("faq_not_visible"));
  assert.ok(codes.has("article_schema_missing"));

  // JS rendering: measured in a real browser when available, otherwise by heuristic. Both must flag /spa.
  const gap = byCode("js_render_gap");
  assert.equal(gap.length, 1, "render gap reported once");
  assert.ok(gap[0].url!.endsWith("/spa"));
  assert.ok(!done.findings.some((f) => f.code === "js_render_gap" && f.url === "http://localhost/"), "normal homepage not flagged");

  // Page data.
  const guide = done.pages.find((p) => p.url.endsWith("/blog/guide"))!;
  assert.ok(guide.answerScore! >= 30);
  assert.ok(done.pagesCount >= 5);

  // Cost log written.
  const logs = await db.apiCallLog.findMany({ where: { orgId: org.id } });
  assert.ok(logs.some((l) => l.provider === "crawl"));
});

test("a rerun replaces results instead of duplicating them", async () => {
  const { db, org, domain } = await seed();
  const crawl = await db.crawl.create({ data: { orgId: org.id, domainId: domain.id } });
  const { runCrawl } = await import("@/worker/crawl");
  await runCrawl(crawl.id);
  const first = await db.finding.count({ where: { crawlId: crawl.id } });
  await runCrawl(crawl.id);
  assert.equal(await db.finding.count({ where: { crawlId: crawl.id } }), first);
});

test("visibility run records every trial, detects brand mentions and citations, and logs cost", async () => {
  const { db, org, domain } = await seed();
  const prompt = await db.prompt.create({ data: { domainId: domain.id, text: "Best remote mail scanning service?" } });
  const run = await db.visibilityRun.create({ data: { orgId: org.id, domainId: domain.id, engines: "chatgpt", trials: 4 } });

  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.openai.com/")) return realFetch(input, init);
    calls++;
    // Trial 1 cites the brand, trial 2 mentions it without a link, trial 3 names a rival, trial 4 errors.
    const n = calls;
    if (n === 4) return new Response("rate limited", { status: 429 });
    const text = n === 1 ? "Acme is great." : n === 2 ? "Acme works too." : "Use Rival Inc.";
    const annotations = n === 1 ? [{ type: "url_citation", url: "http://localhost/blog/guide", title: "Guide" }] : [{ type: "url_citation", url: "https://rival.example/x", title: "Rival" }];
    return Response.json({ output: [{ type: "web_search_call" }, { type: "message", content: [{ type: "output_text", text, annotations }] }], usage: { input_tokens: 1000, output_tokens: 500 } });
  }) as typeof fetch;

  try {
    const { runVisibility } = await import("@/worker/visibility/run");
    await runVisibility(run.id);
  } finally {
    globalThis.fetch = realFetch;
  }

  const done = await db.visibilityRun.findUniqueOrThrow({ where: { id: run.id }, include: { results: { orderBy: { trial: "asc" } } } });
  assert.equal(done.status, "completed");
  assert.equal(done.results.length, 4);
  const ok = done.results.filter((r) => !r.error);
  assert.equal(ok.length, 3);
  assert.equal(ok.filter((r) => r.mentioned).length, 2);
  assert.equal(ok.filter((r) => r.cited).length, 1);
  assert.equal(done.results.filter((r) => r.error).length, 1);
  assert.ok(done.results.every((r) => r.promptId === prompt.id));
  assert.ok(done.costMicros > 0);
  const logged = await db.apiCallLog.aggregate({ where: { orgId: org.id, provider: "chatgpt" }, _sum: { costMicros: true, units: true } });
  assert.equal(logged._sum.units, 3);
  assert.equal(logged._sum.costMicros, done.costMicros);

  // Re-running replaces results rather than appending.
  globalThis.fetch = (async () => new Response("x", { status: 500 })) as typeof fetch;
  try {
    const { runVisibility } = await import("@/worker/visibility/run");
    await runVisibility(run.id);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(await db.visibilityResult.count({ where: { runId: run.id } }), 4);
});
