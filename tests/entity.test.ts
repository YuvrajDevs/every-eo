import { test } from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { articleJsonLd, authorBioHtml, breadcrumbJsonLd, entityChecklist, entitySchema, organizationJsonLd, personJsonLd, scriptTag, wikidataQuickStatements } from "@/lib/entity";
import { defaultEntity, loadEntity, parseEntityForm } from "@/lib/entity-form";
import { flattenJsonLd, schemaFindings } from "@/worker/schema";

const entity = entitySchema.parse({
  name: "Acme Mail",
  url: "acmemail.com/",
  logo: "https://acmemail.com/logo.png",
  description: 'Scans your "post" & forwards it',
  foundingDate: "2019-04",
  email: "help@acmemail.com",
  sameAs: ["https://www.linkedin.com/company/acme-mail/", "https://www.crunchbase.com/organization/acme-mail", "https://x.com/acmemail", "https://www.linkedin.com/company/acme-mail/"],
  authors: [{ name: "Dana Lee", jobTitle: "Head of Ops", url: "https://acmemail.com/team/dana", sameAs: ["https://www.linkedin.com/in/danalee"], knowsAbout: ["mail"] }],
});

test("URLs are normalised to https and sameAs is de-duplicated", () => {
  assert.equal(entity.url, "https://acmemail.com");
  const org = organizationJsonLd(entity);
  assert.equal(org.sameAs!.length, 3);
});

test("generated Organization schema passes our own audit checks", () => {
  const org = organizationJsonLd(entity);
  const findings = schemaFindings({ url: entity.url, nodes: flattenJsonLd(org), isHomepage: true, visibleText: "", wordCount: 300, looksLikeArticle: false });
  assert.deepEqual(findings.map((f) => f.code), []);
});

test("Person schema references the organisation by @id", () => {
  const p = personJsonLd(entity.authors[0], entity);
  assert.deepEqual(p.worksFor, { "@id": "https://acmemail.com/#organization" });
  assert.equal(organizationJsonLd(entity)["@id"], "https://acmemail.com/#organization");
});

test("article and breadcrumb schema pass the validator", () => {
  const art = articleJsonLd({ url: "https://acmemail.com/blog/x", headline: "How it works", datePublished: "2026-01-02" }, entity.authors[0], entity);
  const bc = breadcrumbJsonLd("https://acmemail.com/blog/how-it-works", ["Home"]);
  assert.equal(bc.itemListElement.length, 3);
  assert.equal(bc.itemListElement[2].name, "how it works");
  const findings = schemaFindings({ url: "https://acmemail.com/blog/x", nodes: flattenJsonLd([art, bc]), isHomepage: false, visibleText: "", wordCount: 900, looksLikeArticle: true });
  assert.deepEqual(findings.map((f) => f.code), []);
});

test("script tag cannot be broken out of", () => {
  const evil = entitySchema.parse({ name: "x</script><script>alert(1)</script>", url: "https://a.com" });
  const tag = scriptTag(organizationJsonLd(evil));
  assert.equal((tag.match(/<\/script>/g) ?? []).length, 1);
  const $ = cheerio.load(tag);
  assert.equal(JSON.parse($("script").text()).name, "x</script><script>alert(1)</script>");
});

test("author bio escapes HTML in every field", () => {
  const html = authorBioHtml({ name: "<img src=x onerror=alert(1)>", bio: "a & b", knowsAbout: ["<b>"], sameAs: ['https://x.com/"onmouseover="alert(1)'] });
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes('"onmouseover="'));
  assert.ok(html.includes("a &amp; b"));
});

test("Wikidata draft uses the right properties and extracts profile IDs", () => {
  const qs = wikidataQuickStatements(entity);
  assert.match(qs, /^CREATE\nLAST\tLen\t"Acme Mail"/);
  assert.match(qs, /LAST\tDen\t"Scans your 'post' & forwards it"/);
  assert.match(qs, /LAST\tP31\tQ4830453/);
  assert.match(qs, /LAST\tP856\t"https:\/\/acmemail\.com"/);
  assert.match(qs, /LAST\tP571\t\+2019-04-01T00:00:00Z\/10/);
  assert.match(qs, /LAST\tP4264\t"acme-mail"/);
  assert.match(qs, /LAST\tP2088\t"acme-mail"/);
  assert.match(qs, /LAST\tP2002\t"acmemail"/);
});

test("checklist reflects what's filled in", () => {
  const done = Object.fromEntries(entityChecklist(entity).map((c) => [c.label, c.done]));
  assert.equal(done["LinkedIn company page linked"], true);
  assert.equal(done["Wikidata item linked (draft below if you don't have one)"], false);
  assert.equal(done["Authors link to their own profiles"], true);
});

test("form parsing: author slots, list fields, validation errors", () => {
  const f = new FormData();
  f.set("name", "Acme");
  f.set("url", "acme.com");
  f.set("sameAs", "https://linkedin.com/company/acme\n\n https://g2.com/products/acme ");
  f.set("author.0.name", "Dana");
  f.set("author.0.knowsAbout", "mail, scanning");
  f.set("author.1.name", "");
  f.set("author.2.name", "Sam");
  const ok = parseEntityForm(f);
  assert.ok(ok.success);
  assert.equal(ok.data!.sameAs.length, 2);
  assert.deepEqual(ok.data!.authors.map((a) => a.name), ["Dana", "Sam"]);
  assert.deepEqual(ok.data!.authors[0].knowsAbout, ["mail", "scanning"]);

  f.set("foundingDate", "April 2019");
  const bad = parseEntityForm(f);
  assert.equal(bad.success, false);
  assert.match(bad.error!.issues[0].message, /YYYY/);
});

test("stored profile loads, and corrupt or missing data falls back to defaults", () => {
  const fallback = defaultEntity("www.acme.com", null);
  assert.equal(fallback.name, "acme");
  assert.equal(loadEntity(null, fallback), fallback);
  assert.equal(loadEntity({ data: JSON.stringify({ name: "" }) }, fallback), fallback);
  assert.equal(loadEntity({ data: JSON.stringify(entity) }, fallback).name, "Acme Mail");
});
