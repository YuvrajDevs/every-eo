import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import path from "node:path";
import * as cheerio from "cheerio";
import { startWordPress, type WordPress } from "./wp/harness";

process.env.AUDIT_TEST_ALLOW_PRIVATE = "1";
process.env.DATABASE_URL = "file:./wp-test.db";
process.env.SESSION_SECRET ??= "wp-test-secret-wp-test-secret-1234567";

const PORT = 8089;
let site: WordPress | null = null;
let postUrl = "";
let domainId = "";
let orgId = "";

const ldNodes = async (url: string) => {
  const $ = cheerio.load(await (await fetch(url)).text());
  return $('script[type="application/ld+json"]').toArray().flatMap((el) => {
    const j = JSON.parse($(el).text());
    return j["@graph"] ?? [j];
  });
};
const metas = async (url: string) => {
  const $ = cheerio.load(await (await fetch(url)).text());
  return $('meta[name="description"]').toArray().map((el) => $(el).attr("content"));
};

before(async () => {
  fs.rmSync("wp-test.db", { force: true });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
  site = await startWordPress(PORT);
  if (!site) return;
  // A site whose robots.txt blocks an AI search bot and a training bot, the way a security plugin might.
  fs.mkdirSync(path.join(site.dir, "wp-content/mu-plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(site.dir, "wp-content/mu-plugins/blocker.php"),
    `<?php add_filter('robots_txt', function ($o) { return $o . "\\nUser-agent: PerplexityBot\\nUser-agent: Bytespider\\nDisallow: /\\n\\nUser-agent: GPTBot\\nDisallow: /\\n"; }, 10);`,
  );
  postUrl = site.php(`$id = wp_insert_post(['post_title' => 'How remote mail works', 'post_content' => '<p>Remote mail scanning turns your paper post into searchable PDFs, so you can read letters from anywhere.</p>', 'post_status' => 'publish']); echo get_permalink($id);`).trim();
  const { db } = await import("@/lib/db");
  const org = await db.organization.create({ data: { name: "Agency" } });
  const domain = await db.domain.create({ data: { orgId: org.id, hostname: "localhost" } });
  orgId = org.id;
  domainId = domain.id;
});

after(async () => {
  site?.stop();
  await (await import("@/lib/db")).db.$disconnect();
  fs.rmSync("wp-test.db", { force: true });
});

describe("WordPress connector against a real WordPress install", { skip: !fs.existsSync("/usr/bin/php") && "php not installed" }, () => {
  test("rejects a wrong application password with a clear message", async (t) => {
    if (!site) return t.skip("WordPress test environment unavailable");
    const { connectWordPress } = await import("@/lib/fix-engine");
    await assert.rejects(connectWordPress(domainId, { siteUrl: site.url, username: "admin", appPassword: "aaaa bbbb cccc dddd eeee ffff" }), /application password|rejected the login/i);
  });

  test("rejects a non-administrator", async (t) => {
    if (!site) return t.skip();
    const pw = site.php(`$u = wp_insert_user(['user_login' => 'writer', 'user_pass' => 'writer-pass-123', 'role' => 'author']); [$p] = WP_Application_Passwords::create_new_application_password($u, ['name' => 't']); echo $p;`).trim();
    const { connectWordPress } = await import("@/lib/fix-engine");
    await assert.rejects(connectWordPress(domainId, { siteUrl: site.url, username: "writer", appPassword: pw }), /isn't an administrator/);
  });

  test("reports a missing plugin clearly", async (t) => {
    if (!site) return t.skip();
    site.php(`require_once ABSPATH . 'wp-admin/includes/plugin.php'; deactivate_plugins('visibility-connector/visibility-connector.php');`);
    const { connectWordPress } = await import("@/lib/fix-engine");
    try {
      await assert.rejects(connectWordPress(domainId, { siteUrl: site.url, username: site.user, appPassword: site.appPassword }), /plugin isn't installed or active/);
    } finally {
      site.php(`require_once ABSPATH . 'wp-admin/includes/plugin.php'; activate_plugin('visibility-connector/visibility-connector.php');`);
    }
  });

  test("connects, and stores the password encrypted", async (t) => {
    if (!site) return t.skip();
    const { connectWordPress } = await import("@/lib/fix-engine");
    const status = await connectWordPress(domainId, { siteUrl: `${site.url}/`, username: site.user, appPassword: site.appPassword });
    assert.equal(status.plugin, "0.1.0");
    assert.equal(status.yoast, false);
    const { db } = await import("@/lib/db");
    const c = await db.wpConnection.findUniqueOrThrow({ where: { domainId } });
    assert.equal(c.siteUrl, site.url);
    assert.ok(!c.secret.includes(site.appPassword.replace(/ /g, "")) && !c.secret.includes(site.appPassword));
    const { decrypt } = await import("@/lib/secrets");
    assert.equal(decrypt(c.secret), site.appPassword);
  });

  test("Organization schema: applied, verified on the live homepage, safely escaped, and rolled back", async (t) => {
    if (!site) return t.skip();
    const { applyFix, rollbackFix } = await import("@/lib/fix-engine");
    const { proposeFixes } = await import("@/lib/fixes");
    const { entitySchema } = await import("@/lib/entity");
    const entity = entitySchema.parse({ name: "Acme </script><b>x</b>", url: site.url, logo: `${site.url}/logo.png`, sameAs: ["https://www.linkedin.com/company/acme"] });
    const { proposals } = proposeFixes({ homepage: `${site.url}/`, hostname: "localhost", entity, pages: [], findings: [{ code: "organization_no_sameas", url: `${site.url}/` }] });
    const fix = await applyFix(orgId, domainId, proposals[0]);
    assert.equal(fix.status, "verified", fix.error ?? "");
    const html = await (await fetch(`${site.url}/`)).text();
    assert.ok(!html.includes("</script><b>x</b>"), "name must not break out of the script tag");
    const orgs = (await ldNodes(`${site.url}/`)).filter((n) => n["@type"] === "Organization");
    assert.equal(orgs.length, 1);
    assert.equal(orgs[0].name, "Acme </script><b>x</b>");
    assert.deepEqual(orgs[0].sameAs, ["https://www.linkedin.com/company/acme"]);
    assert.equal((await ldNodes(postUrl)).filter((n) => n["@type"] === "Organization").length, 0, "homepage-only fix must not appear on posts");

    const again = await applyFix(orgId, domainId, proposals[0]);
    assert.equal(again.id, fix.id, "re-applying updates the same fix");
    assert.equal((await ldNodes(`${site.url}/`)).filter((n) => n["@type"] === "Organization").length, 1, "no duplicate block after re-apply");

    const rolled = await rollbackFix(fix.id);
    assert.equal(rolled.status, "rolled_back");
    assert.equal((await ldNodes(`${site.url}/`)).filter((n) => n["@type"] === "Organization").length, 0);
  });

  test("meta description and Article schema on a post", async (t) => {
    if (!site) return t.skip();
    const { applyFix, rollbackFix } = await import("@/lib/fix-engine");
    const { proposeFixes } = await import("@/lib/fixes");
    const page = { url: postUrl, statusCode: 200, title: "How remote mail works – Test Site", h1: "How remote mail works", metaDescription: null, metaRobots: null, excerpt: "Remote mail scanning turns your paper post into searchable PDFs, so you can read letters from anywhere." };
    const { proposals } = proposeFixes({ homepage: `${site.url}/`, hostname: "localhost", entity: null, pages: [page], findings: [{ code: "missing_meta_description", url: postUrl }, { code: "article_schema_missing", url: postUrl }] });
    const meta = proposals.find((p) => p.type === "meta_description")!;
    const article = proposals.find((p) => p.type === "jsonld")!;
    assert.equal(meta.payload.text, page.excerpt);

    const m = await applyFix(orgId, domainId, meta, 'Edited: read your post anywhere & "fast"');
    assert.equal(m.status, "verified", m.error ?? "");
    assert.deepEqual(await metas(postUrl), ['Edited: read your post anywhere & "fast"']);
    assert.deepEqual(await metas(`${site.url}/`), [], "post-only fix stays on the post");

    const a = await applyFix(orgId, domainId, article);
    assert.equal(a.status, "verified", a.error ?? "");
    const art = (await ldNodes(postUrl)).find((n) => n["@type"] === "Article");
    assert.equal(art.headline, "How remote mail works");

    await rollbackFix(m.id);
    await rollbackFix(a.id);
    assert.deepEqual(await metas(postUrl), []);
    assert.equal((await ldNodes(postUrl)).length, 0);
  });

  test("robots.txt: unblocks the AI search bot only; shared groups and training blocks stay intact", async (t) => {
    if (!site) return t.skip();
    const robotsParser = (await import("robots-parser")).default;
    const before = await (await fetch(`${site.url}/robots.txt`)).text();
    const rb = robotsParser(`${site.url}/robots.txt`, before);
    assert.equal(rb.isAllowed(`${site.url}/`, "PerplexityBot"), false);

    const { applyFix, rollbackFix } = await import("@/lib/fix-engine");
    const { proposeFixes } = await import("@/lib/fixes");
    const { proposals } = proposeFixes({ homepage: `${site.url}/`, hostname: "localhost", entity: null, pages: [], findings: [{ code: "bot_blocked_perplexitybot", url: null }, { code: "bot_training_optout_gptbot", url: null }] });
    assert.equal(proposals.length, 1);
    assert.deepEqual(proposals[0].payload.agents, ["PerplexityBot"]);
    const fix = await applyFix(orgId, domainId, proposals[0]);
    assert.equal(fix.status, "verified", fix.error ?? "");

    const txt = await (await fetch(`${site.url}/robots.txt`)).text();
    const r = robotsParser(`${site.url}/robots.txt`, txt);
    assert.equal(r.isAllowed(`${site.url}/`, "PerplexityBot"), true);
    assert.equal(r.isAllowed(`${site.url}/`, "Bytespider"), false, "other agent in the shared group stays blocked");
    assert.equal(r.isAllowed(`${site.url}/`, "GPTBot"), false, "training opt-out untouched");
    assert.equal(r.isAllowed(`${site.url}/wp-admin/`, "Googlebot"), false, "default WordPress rules kept");
    assert.ok(r.getSitemaps().length > 0, "sitemap line kept");

    await rollbackFix(fix.id);
    assert.equal(await (await fetch(`${site.url}/robots.txt`)).text(), before);
  });

  test("deactivating the plugin removes every applied fix", async (t) => {
    if (!site) return t.skip();
    const { applyFix } = await import("@/lib/fix-engine");
    const { entitySchema } = await import("@/lib/entity");
    const { proposeFixes } = await import("@/lib/fixes");
    const entity = entitySchema.parse({ name: "Acme", url: site.url, sameAs: ["https://x.com/acme"] });
    const { proposals } = proposeFixes({ homepage: `${site.url}/`, hostname: "localhost", entity, pages: [], findings: [{ code: "no_organization_schema", url: null }] });
    await applyFix(orgId, domainId, proposals[0]);
    assert.equal((await ldNodes(`${site.url}/`)).length, 1);
    site.php(`require_once ABSPATH . 'wp-admin/includes/plugin.php'; deactivate_plugins('visibility-connector/visibility-connector.php');`);
    assert.equal((await ldNodes(`${site.url}/`)).length, 0);
    site.php(`require_once ABSPATH . 'wp-admin/includes/plugin.php'; activate_plugin('visibility-connector/visibility-connector.php');`);
  });

  test("plugin rejects malformed fixes", async (t) => {
    if (!site) return t.skip();
    const { wp } = await import("@/lib/wordpress");
    const creds = { siteUrl: site.url, username: site.user, appPassword: site.appPassword };
    await assert.rejects(wp.apply(creds, { id: "bad id!", type: "jsonld", sitewide: true, payload: { data: { "@type": "X" } } }), /id, a known type/);
    await assert.rejects(wp.apply(creds, { id: "ok", type: "jsonld", sitewide: true, payload: { data: { name: "no type" } } }), /@type/);
    await assert.rejects(wp.apply(creds, { id: "ok", type: "meta_description", url: `${site.url}/no-such-page/`, payload: { text: "x" } }), /No page on this site/);
    await assert.rejects(wp.apply(creds, { id: "ok", type: "robots_allow", sitewide: true, payload: { agents: ["<>"] } }), /at least one user agent/);
  });
});

describe("WordPress with Yoast SEO (filter-contract stub) and a physical robots.txt", () => {
  let yoast: WordPress | null = null;
  let yDomain = "";
  let yPost = "";
  before(async () => {
    yoast = await startWordPress(PORT + 1, { yoastStub: true, robotsFile: "User-agent: PerplexityBot\nDisallow: /\n" });
    if (!yoast) return;
    yPost = yoast.php(`$id = wp_insert_post(['post_title' => 'Pricing', 'post_content' => 'x', 'post_status' => 'publish']); update_post_meta($id, '_yoast_wpseo_metadesc', 'Old Yoast description'); echo get_permalink($id);`).trim();
    const { db } = await import("@/lib/db");
    yDomain = (await db.domain.create({ data: { orgId, hostname: "localhost-yoast" } })).id;
    const { connectWordPress } = await import("@/lib/fix-engine");
    const status = await connectWordPress(yDomain, { siteUrl: yoast.url, username: yoast.user, appPassword: yoast.appPassword });
    assert.equal(status.yoast, true);
    assert.equal(status.robots_file, true);
  });
  after(() => yoast?.stop());

  test("Organization merges into Yoast's graph instead of adding a second one", async (t) => {
    if (!yoast) return t.skip();
    const { applyFix, rollbackFix } = await import("@/lib/fix-engine");
    const { entitySchema } = await import("@/lib/entity");
    const { proposeFixes } = await import("@/lib/fixes");
    const entity = entitySchema.parse({ name: "Acme", url: yoast.url, sameAs: ["https://www.linkedin.com/company/acme"] });
    const { proposals } = proposeFixes({ homepage: `${yoast.url}/`, hostname: "x", entity, pages: [], findings: [{ code: "organization_no_sameas", url: null }] });
    const fix = await applyFix(orgId, yDomain, proposals[0]);
    assert.equal(fix.status, "verified", fix.error ?? "");
    const orgs = (await ldNodes(`${yoast.url}/`)).filter((n) => n["@type"] === "Organization");
    assert.equal(orgs.length, 1);
    assert.equal(orgs[0]["@id"], `${yoast.url}/#organization`, "Yoast's own node, extended");
    assert.deepEqual(orgs[0].sameAs, ["https://www.linkedin.com/company/acme"]);
    await rollbackFix(fix.id);
    assert.equal((await ldNodes(`${yoast.url}/`)).find((n) => n["@type"] === "Organization").sameAs, undefined);
  });

  test("meta description goes into Yoast's field, and rollback restores the old value", async (t) => {
    if (!yoast) return t.skip();
    const { applyFix, rollbackFix } = await import("@/lib/fix-engine");
    const fix = await applyFix(orgId, yDomain, { key: "meta:/pricing/", type: "meta_description", findingCode: "missing_meta_description", title: "t", why: "", evidence: "proven", url: yPost, payload: { text: "New description" } });
    assert.equal(fix.status, "verified", fix.error ?? "");
    assert.deepEqual(await metas(yPost), ["New description"], "exactly one description tag (Yoast's)");
    await rollbackFix(fix.id);
    assert.deepEqual(await metas(yPost), ["Old Yoast description"]);
  });

  test("a physical robots.txt can't be changed; the fix is reported as not visible with the reason", async (t) => {
    if (!yoast) return t.skip();
    const { applyFix } = await import("@/lib/fix-engine");
    const fix = await applyFix(orgId, yDomain, { key: "robots-allow", type: "robots_allow", findingCode: "bot_blocked_perplexitybot", title: "t", why: "", evidence: "proven", sitewide: true, payload: { agents: ["PerplexityBot"] } });
    assert.equal(fix.status, "not_visible");
    assert.match(fix.error!, /robots\.txt file in your web root/);
  });
});

describe("robots.txt rewrite (PHP unit)", { skip: !fs.existsSync("/usr/bin/php") && "php not installed" }, () => {
  const rewrite = (input: string, agents: string[]) =>
    execFileSync("php", ["-r", `define('ABSPATH', '/'); require '${path.resolve("integrations/wordpress/visibility-connector/includes/robots.php")}'; echo vcon_robots_allow(${JSON.stringify(input).replace(/\$/g, "\\$")}, json_decode('${JSON.stringify(agents)}'));`], { encoding: "utf8" });
  test("handles wildcard blocks, comments, CRLF and case-insensitive agent names", async () => {
    const robotsParser = (await import("robots-parser")).default;
    const out = rewrite("# comment\r\nUser-agent: *\r\nDisallow: /\r\n\r\nUser-agent: oai-searchbot\r\nDisallow: /private\r\n\r\nSitemap: https://x.com/s.xml\r\n", ["OAI-SearchBot"]);
    const r = robotsParser("https://x.com/robots.txt", out);
    assert.equal(r.isAllowed("https://x.com/private", "OAI-SearchBot"), true);
    assert.equal(r.isAllowed("https://x.com/", "SomeOtherBot"), false, "everyone else still blocked by *");
    assert.deepEqual(r.getSitemaps(), ["https://x.com/s.xml"]);
  });
  test("empty robots.txt gets just the allow group", () => {
    assert.equal(rewrite("", ["PerplexityBot"]), "User-agent: PerplexityBot\nAllow: /\n");
  });
});
