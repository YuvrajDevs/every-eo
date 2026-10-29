import { test } from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { wilson } from "@/lib/stats";
import { healthScore } from "@/lib/health";
import { brandTerms, detect } from "@/worker/visibility/run";
import { answerScore, answerSignals } from "@/worker/answer";
import { faqSpamFinding, flattenJsonLd, schemaFindings } from "@/worker/schema";
import { hasRenderGap } from "@/worker/render";
import { normalizeHostname } from "@/lib/url-safety";
import { assertPublicUrl } from "@/lib/url-safety";

test("wilson interval brackets the observed rate and widens with fewer trials", () => {
  const small = wilson(2, 5);
  const big = wilson(40, 100);
  assert.ok(small.low < 0.4 && small.high > 0.4);
  assert.ok(small.high - small.low > big.high - big.low);
  assert.deepEqual(wilson(0, 0), { rate: 0, low: 0, high: 0 });
  assert.ok(wilson(5, 5).high <= 1 && wilson(0, 5).low >= 0);
});

test("health score penalises by severity and floors at zero", () => {
  assert.equal(healthScore([{ severity: "high" }, { severity: "medium" }, { severity: "low" }, { severity: "info" }]), 79);
  assert.equal(healthScore(Array(10).fill({ severity: "high" })), 0);
});

test("brand detection matches spaced names, domains, and cited hosts", () => {
  const terms = brandTerms("www.honestmailbox.com", "Honest Mailbox");
  assert.ok(detect("Try Honest Mailbox for scanning.", [], "www.honestmailbox.com", terms).mentioned);
  assert.ok(detect("See honestmailbox.com", [], "www.honestmailbox.com", terms).mentioned);
  const cited = detect("no name here", [{ url: "https://blog.honestmailbox.com/x", title: null }], "www.honestmailbox.com", terms);
  assert.ok(cited.cited && cited.mentioned);
  const other = detect("Use Competitor", [{ url: "https://nothonestmailbox.example/x", title: null }], "honestmailbox.com", terms);
  assert.equal(other.cited, false);
});

test("answer readiness rewards direct answers, question headings, lists and stats", () => {
  const good = cheerio.load(`<body><main><p>${"Word ".repeat(30)}</p><h2>What is it?</h2><h2>How does it work?</h2><h2>Pricing</h2>
    <ul><li>a</li><li>b</li><li>c</li></ul><p>Grew 45% in 2025, up 1,200 users, 30% more.</p></main></body>`);
  const bad = cheerio.load("<body><p>Hi</p></body>");
  assert.ok(answerScore(answerSignals(good, [])) >= 70);
  assert.ok(answerScore(answerSignals(bad, [])) < 20);
});

test("schema validator flags incomplete Organization, hidden FAQ questions, and passes good markup", () => {
  const base = { url: "https://x.com/", isHomepage: true, wordCount: 500, looksLikeArticle: false };
  const bad = schemaFindings({ ...base, visibleText: "hello", nodes: flattenJsonLd({ "@graph": [{ "@type": "Organization", name: "X" }, { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Secret hidden question here?" }] }] }) });
  const codes = bad.map((f) => f.code);
  assert.ok(codes.includes("organization_incomplete") && codes.includes("organization_no_sameas") && codes.includes("faq_not_visible"));
  const good = schemaFindings({
    ...base,
    visibleText: "what is x? answer",
    nodes: flattenJsonLd([{ "@type": "Organization", name: "X", url: "https://x.com", logo: "l.png", sameAs: ["https://linkedin.com/x"] }, { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "What is X?" }] }]),
  });
  assert.deepEqual(good, []);
  const article = schemaFindings({ url: "https://x.com/blog/a", nodes: [], isHomepage: false, visibleText: "", wordCount: 900, looksLikeArticle: true });
  assert.ok(article.some((f) => f.code === "article_schema_missing"));
  assert.equal(faqSpamFinding(Array(10).fill(["FAQPage"]))?.evidence, "speculative");
  assert.equal(faqSpamFinding([["FAQPage"], ["Article"], ["Article"]]), null);
});

test("render gap needs a large absolute and relative jump", () => {
  assert.ok(hasRenderGap({ url: "u", rawWords: 20, renderedWords: 400 }));
  assert.equal(hasRenderGap({ url: "u", rawWords: 300, renderedWords: 400 }), false);
  assert.equal(hasRenderGap({ url: "u", rawWords: 5, renderedWords: 50 }), false);
});

test("hostname normalisation rejects non-public targets", () => {
  assert.equal(normalizeHostname("https://Example.com/path"), "example.com");
  for (const bad of ["localhost", "10.0.0.1", "intranet.local", "nodots", "http://[::1]/"]) assert.throws(() => normalizeHostname(bad));
});

test("SSRF guard blocks private addresses outside test mode", async () => {
  const saved = process.env.NODE_ENV;
  const savedFlag = process.env.AUDIT_TEST_ALLOW_PRIVATE;
  (process.env as Record<string, string>).NODE_ENV = "production";
  process.env.AUDIT_TEST_ALLOW_PRIVATE = "1";
  try {
    await assert.rejects(assertPublicUrl("http://127.0.0.1/"));
    await assert.rejects(assertPublicUrl("http://169.254.169.254/latest/meta-data"));
    await assert.rejects(assertPublicUrl("http://[::ffff:10.0.0.1]/"));
    await assert.rejects(assertPublicUrl("file:///etc/passwd"));
  } finally {
    (process.env as Record<string, string>).NODE_ENV = saved;
    if (savedFlag === undefined) delete process.env.AUDIT_TEST_ALLOW_PRIVATE;
    else process.env.AUDIT_TEST_ALLOW_PRIVATE = savedFlag;
  }
});
