import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";

process.env.AUDIT_TEST_ALLOW_PRIVATE = "1";
process.env.DATABASE_URL = "file:./edge-test.db";
process.env.RENDER_CHECK = "off";

type Handler = (path: string, ua: string, res: http.ServerResponse) => boolean | void;
let handler: Handler = () => false;
let server: http.Server;

const html = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i % 30}`).join(" ");
const okHead = (t: string) => `<title>${t} page for the test site</title><meta name="description" content="${"A reasonably long meta description that sits inside the recommended length range for search results. ".slice(0, 130)}">`;
const send = (res: http.ServerResponse, status: number, type: string, body: string) => {
  res.writeHead(status, { "content-type": type }).end(body);
  return true;
};

before(async () => {
  fs.rmSync("edge-test.db", { force: true });
  (await import("node:child_process")).execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
  server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (!handler(path, String(req.headers["user-agent"] ?? ""), res)) send(res, 404, "text/html", "nope");
  });
  await new Promise<void>((r) => server.listen(80, r));
});
after(async () => {
  server.close();
  await (await import("@/lib/db")).db.$disconnect();
  fs.rmSync("edge-test.db", { force: true });
});

async function audit(h: Handler, maxPages = 50) {
  handler = h;
  const { db } = await import("@/lib/db");
  const org = await db.organization.create({ data: { name: "o" } });
  const domain = await db.domain.create({ data: { orgId: org.id, hostname: "localhost" } });
  const crawl = await db.crawl.create({ data: { orgId: org.id, domainId: domain.id, maxPages } });
  const { runCrawl } = await import("@/worker/crawl");
  await runCrawl(crawl.id);
  const done = await db.crawl.findUniqueOrThrow({ where: { id: crawl.id }, include: { findings: true, pages: true, robots: true } });
  return { done, codes: new Set(done.findings.map((f) => f.code)), titles: done.findings.map((f) => f.title) };
}

test("duplicate titles, foreign canonicals, noindex, 500s, and collapsed repeats", async () => {
  const { done, codes, titles } = await audit((path, _ua, res) => {
    if (path === "/robots.txt") return send(res, 404, "text/plain", "");
    const pages: Record<string, string> = {
      "/": html(okHead("Home"), `<h1>Home</h1><p>${words(60)}</p>${["a", "b", "c", "d", "e"].map((p) => `<a href="/${p}">${p}</a>`).join("")}<a href="/boom">boom</a><a href="/noidx">n</a>`),
      "/a": html(`<title>Same title</title>`, `<h1>A</h1><p>${words(300)}</p>`),
      "/b": html(`<title>Same title</title><link rel="canonical" href="https://other-site.example/b">`, `<h1>B</h1><p>${words(300)}</p>`),
      "/c": html(`<title>Unique C</title>`, `<h1>C</h1><p>${words(300)}</p>`),
      "/d": html(`<title>Unique D</title>`, `<h1>D</h1><p>${words(300)}</p>`),
      "/e": html(`<title>Unique E</title>`, `<h1>E</h1><p>${words(300)}</p>`),
      "/noidx": html(`<title>Hidden</title><meta name="robots" content="noindex,nofollow">`, `<h1>H</h1><p>${words(300)}</p>`),
    };
    if (path === "/boom") return send(res, 500, "text/html", "error");
    if (pages[path]) return send(res, 200, "text/html", pages[path]);
  });
  assert.equal(done.status, "completed");
  assert.ok(codes.has("robots_missing"));
  assert.ok(codes.has("duplicate_title"));
  assert.ok(codes.has("canonical_other_site"));
  assert.ok(codes.has("noindex"));
  assert.ok(codes.has("http_error"));
  assert.ok(titles.some((t) => /^6 pages have no meta description$/.test(t)), `collapsed finding missing: ${titles.join(" | ")}`);
  assert.equal(done.findings.filter((f) => f.code === "missing_meta_description").length, 1, "repeats collapse to one finding");
  assert.ok(!codes.has("js_render_gap"));
});

test("redirects are followed once, cycles terminate, non-HTML links are ignored", async () => {
  const { done } = await audit((path, _ua, res) => {
    if (path === "/robots.txt") return send(res, 200, "text/plain", "User-agent: *\nAllow: /\n");
    if (path === "/old") {
      res.writeHead(301, { location: "/new" }).end();
      return true;
    }
    if (path === "/new") return send(res, 200, "text/html", html(okHead("New"), `<h1>New</h1><p>${words(80)}</p><a href="/">home</a><a href="/new">self</a>`));
    if (path === "/") return send(res, 200, "text/html", html(okHead("Home"), `<h1>H</h1><p>${words(80)}</p><a href="/old">old</a><a href="/old">old again</a><a href="/doc.pdf">pdf</a><a href="/img.png">img</a><a href="mailto:a@b.c">m</a><a href="https://elsewhere.example/">ext</a><a href="/#frag">frag</a>`));
  });
  assert.equal(done.status, "completed");
  const urls = done.pages.map((p) => new URL(p.url).pathname).sort();
  assert.deepEqual(urls, ["/", "/new"]);
  assert.ok(!done.findings.some((f) => f.code === "http_error"));
});

test("sitemap index pages are audited and orphans reported; robots blocking everyone flags search bots", async () => {
  const { done, codes } = await audit((path, _ua, res) => {
    if (path === "/robots.txt") return send(res, 200, "text/plain", "User-agent: *\nDisallow: /\nSitemap: http://localhost/index.xml\n");
    if (path === "/index.xml") return send(res, 200, "application/xml", `<sitemapindex><sitemap><loc>http://localhost/child.xml</loc></sitemap></sitemapindex>`);
    if (path === "/child.xml") return send(res, 200, "application/xml", `<urlset><url><loc>http://localhost/</loc></url><url><loc>http://localhost/deep</loc></url></urlset>`);
    if (path === "/deep" || path === "/") return send(res, 200, "text/html", html(okHead(path), `<h1>x</h1><p>${words(80)}</p>`));
  });
  assert.ok(done.pages.some((p) => p.url.endsWith("/deep")), "page found only via sitemap index is crawled");
  assert.ok(codes.has("orphan_pages"));
  assert.ok(codes.has("bot_blocked_oai-searchbot") && codes.has("bot_blocked_claude-searchbot") && codes.has("bot_blocked_googlebot"));
  assert.ok(codes.has("bot_training_optout_gptbot"));
});

test("robots.txt that is really an HTML page is treated as missing", async () => {
  const { codes, done } = await audit((path, _ua, res) => {
    if (path === "/") return send(res, 200, "text/html", html(okHead("Home"), `<h1>H</h1><p>${words(80)}</p>`));
    return send(res, 200, "text/html", html("<title>SPA shell</title>", "<div>app</div>"));
  });
  assert.ok(codes.has("robots_missing"));
  assert.equal(done.robots!.found, false);
});

test("page cap is respected and an oversized page does not crash the crawl", async () => {
  const { done } = await audit((path, _ua, res) => {
    if (path === "/robots.txt") return send(res, 404, "text/plain", "");
    if (path === "/") return send(res, 200, "text/html", html(okHead("Home"), `<h1>H</h1><p>${words(80)}</p>${Array.from({ length: 60 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join("")}<a href="/huge">huge</a>`));
    if (path === "/huge") return send(res, 200, "text/html", html(okHead("Huge"), `<h1>H</h1><p>${"lorem ipsum ".repeat(400_000)}</p>`));
    if (/^\/p\d+$/.test(path)) return send(res, 200, "text/html", html(okHead(path), `<h1>P</h1><p>${words(60)}</p>`));
  }, 20);
  assert.equal(done.status, "completed");
  assert.equal(done.pagesCount, 20);
  assert.equal(done.pages.length, 20);
});

test("a site that is down fails the audit cleanly", async () => {
  handler = (_p, _u, res) => {
    res.destroy();
    return true;
  };
  const { db } = await import("@/lib/db");
  const org = await db.organization.create({ data: { name: "o2" } });
  const domain = await db.domain.create({ data: { orgId: org.id, hostname: "localhost" } });
  const crawl = await db.crawl.create({ data: { orgId: org.id, domainId: domain.id } });
  const { runCrawl } = await import("@/worker/crawl");
  await assert.rejects(runCrawl(crawl.id));
});
