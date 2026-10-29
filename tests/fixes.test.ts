import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeFixes, remoteId, suggestDescription } from "@/lib/fixes";
import { entitySchema } from "@/lib/entity";

const base = { homepage: "https://acme.com/", hostname: "acme.com", pages: [], findings: [] as { code: string; url: string | null }[], entity: null };

test("description suggestions: short text untouched, long text cut at a sentence or word", () => {
  assert.equal(suggestDescription("Short and sweet."), "Short and sweet.");
  const long = "Remote mail scanning turns paper post into PDFs you can search. It works from any device, anywhere in the world. Plans start at ten dollars per month and include forwarding.";
  const s = suggestDescription(long);
  assert.ok(s.length <= 155 && s.endsWith("."), s);
  const noStops = "word ".repeat(60);
  const t = suggestDescription(noStops);
  assert.ok(t.length <= 153 && t.endsWith("…") && !t.includes("  "));
});

test("remote ids are stable, short and plugin-safe", () => {
  assert.equal(remoteId("meta:/a"), remoteId("meta:/a"));
  assert.notEqual(remoteId("meta:/a"), remoteId("meta:/b"));
  assert.match(remoteId("article:/über/ünïcode?x=1"), /^[A-Za-z0-9_-]{1,64}$/);
});

test("Organization fix needs a saved brand profile", () => {
  const without = proposeFixes({ ...base, findings: [{ code: "no_organization_schema", url: null }] });
  assert.equal(without.proposals.length, 0);
  assert.deepEqual(without.blocked.map((b) => b.needs), ["entity"]);
  const entity = entitySchema.parse({ name: "Acme", url: "https://acme.com", sameAs: ["https://x.com/acme"] });
  const withEntity = proposeFixes({ ...base, entity, findings: [{ code: "organization_no_sameas", url: null }] });
  assert.equal(withEntity.proposals[0].key, "org-home");
  assert.equal(withEntity.proposals[0].url, "https://acme.com/");
});

test("meta description fixes come from pages, skipping broken, noindex, already-described and excerpt-less pages", () => {
  const page = (url: string, extra: Record<string, unknown> = {}) => ({ url, statusCode: 200, title: "T", h1: "H", metaDescription: null, metaRobots: null, excerpt: "An opening paragraph that says what this page is about in plain words.", ...extra });
  const { proposals } = proposeFixes({
    ...base,
    findings: [{ code: "missing_meta_description", url: "https://acme.com/a" }],
    pages: [page("https://acme.com/a"), page("https://acme.com/b"), page("https://acme.com/c", { statusCode: 404 }), page("https://acme.com/d", { metaRobots: "noindex" }), page("https://acme.com/e", { metaDescription: "has one" }), page("https://acme.com/f", { excerpt: null })],
  });
  assert.deepEqual(proposals.map((p) => p.key), ["meta:/a", "meta:/b"]);
  assert.ok(proposals.every((p) => p.editableText));
});

test("robots fix lists only blocked search/live-fetch bots, never training bots", () => {
  const { proposals } = proposeFixes({
    ...base,
    findings: [{ code: "bot_blocked_oai-searchbot", url: null }, { code: "bot_blocked_perplexity-user", url: null }, { code: "bot_training_optout_gptbot", url: null }, { code: "bot_blocked_googlebot", url: null }],
  });
  assert.equal(proposals.length, 1);
  assert.deepEqual(proposals[0].payload.agents, ["OAI-SearchBot", "Perplexity-User", "Googlebot"]);
});

test("article fix uses the H1, or the title without the site-name suffix", () => {
  const { proposals } = proposeFixes({
    ...base,
    findings: [{ code: "article_schema_missing", url: "https://acme.com/blog/x" }, { code: "article_schema_missing", url: "https://acme.com/blog/y" }],
    pages: [
      { url: "https://acme.com/blog/x", statusCode: 200, title: "Guide – Acme", h1: null, metaDescription: null, metaRobots: null, excerpt: null },
      { url: "https://acme.com/blog/y", statusCode: 200, title: null, h1: null, metaDescription: null, metaRobots: null, excerpt: null },
    ],
  });
  assert.equal(proposals.length, 1, "no headline → no fix");
  assert.equal((proposals[0].payload.data as { headline: string }).headline, "Guide");
});

test("credential encryption round-trips and detects tampering", async () => {
  process.env.SESSION_SECRET ??= "unit-test-secret-unit-test-secret-123";
  const { encrypt, decrypt } = await import("@/lib/secrets");
  const sealed = encrypt("abcd efgh ijkl");
  assert.notEqual(sealed, encrypt("abcd efgh ijkl"), "random IV");
  assert.equal(decrypt(sealed), "abcd efgh ijkl");
  const parts = sealed.split(".");
  parts[3] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decrypt(parts.join(".")));
});
