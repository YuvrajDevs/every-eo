import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPlatform, findingFamily, guidanceFor } from "@/lib/platforms";
import { healthScore } from "@/lib/health";

const cases: [string, string, Record<string, string>][] = [
  ["wix", `<meta name="generator" content="Wix.com Website Builder"><img src="https://static.wixstatic.com/media/x.jpg">`, {}],
  ["wix", `<div></div>`, { "x-wix-request-id": "abc" }],
  ["squarespace", `<!-- This is Squarespace. --><link href="https://static1.squarespace.com/static/x.css">`, {}],
  ["webflow", `<html data-wf-page="123" data-wf-site="456"><meta content="Webflow" name="generator">`, {}],
  ["shopify", `<script>Shopify.theme = {"name":"Dawn"};</script><link href="//cdn.shopify.com/s/files/x.css">`, {}],
  ["wordpress", `<meta name="generator" content="WordPress 6.6"><link rel="stylesheet" href="/wp-content/themes/x/style.css">`, {}],
  ["wordpress", `<p>hi</p>`, { link: '<https://x.com/wp-json/>; rel="https://api.w.org/"' }],
  ["ghost", `<meta name="generator" content="Ghost 5.0">`, {}],
  ["framer", `<meta name="generator" content="Framer 1a2b">`, {}],
  ["unknown", `<html><body>Hand-written site</body></html>`, {}],
];

test("detects each platform from realistic markup and headers", () => {
  for (const [expected, html, headers] of cases) assert.equal(detectPlatform(html, headers), expected, html.slice(0, 60));
});

test("a WordPress site embedding a Shopify buy button is still WordPress", () => {
  const html = `<meta name="generator" content="WordPress 6.6"><link href="/wp-content/x.css"><script src="/wp-includes/js/x.js"></script><script src="https://cdn.shopify.com/buy-button.js"></script>`;
  assert.equal(detectPlatform(html, {}), "wordpress");
});

test("finding codes map to families, including dynamic bot codes", () => {
  assert.equal(findingFamily("bot_blocked_oai-searchbot"), "robots");
  assert.equal(findingFamily("bot_training_optout_gptbot"), "ai_block");
  assert.equal(findingFamily("firewall_blocks_claude-user"), "firewall");
  assert.equal(findingFamily("organization_no_sameas"), "schema");
  assert.equal(findingFamily("canonical_other_site"), "canonical");
  assert.equal(findingFamily("something_new"), null);
});

test("guidance reflects what each builder lets the owner change", () => {
  assert.equal(guidanceFor("squarespace", "bot_blocked_perplexitybot")?.fixability, "platform");
  assert.equal(guidanceFor("squarespace", "bot_training_optout_gptbot")?.fixability, "setting");
  assert.match(guidanceFor("squarespace", "organization_no_sameas")!.howTo, /code injection/i);
  assert.equal(guidanceFor("webflow", "bot_blocked_perplexitybot")?.fixability, "you");
  assert.equal(guidanceFor("wix", "no_sitemap")?.fixability, "platform");
  assert.equal(guidanceFor("unknown", "missing_title"), null, "no platform → no extra guidance, generic detail still applies");
  assert.equal(guidanceFor("wix", "something_new"), null);
});

test("platform-controlled issues don't lower the health score", () => {
  assert.equal(healthScore([{ severity: "high", fixability: "platform" }]), 100);
  assert.equal(healthScore([{ severity: "high", fixability: "setting" }, { severity: "high" }]), 70);
});
