import type { FindingInput } from "@/worker/robots";

type Node = Record<string, unknown>;

// Flattens JSON-LD (arrays, @graph) into individual typed nodes.
export function flattenJsonLd(root: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(root)) root.forEach((n) => flattenJsonLd(n, out));
  else if (root && typeof root === "object") {
    const obj = root as Node;
    if (obj["@type"]) out.push(obj);
    if (obj["@graph"]) flattenJsonLd(obj["@graph"], out);
  }
  return out;
}

const typesOf = (n: Node) => [n["@type"]].flat().filter((t): t is string => typeof t === "string");
const has = (n: Node, key: string) => {
  const v = n[key];
  return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "";
};
const ARTICLE = /^(Article|BlogPosting|NewsArticle|TechArticle)$/;
const ORG = /(^|[a-z])Organization$|^LocalBusiness$/;

export type SchemaPageInput = {
  url: string;
  nodes: Node[];
  isHomepage: boolean;
  visibleText: string; // lowercased page text
  wordCount: number;
  looksLikeArticle: boolean;
};

// Checks structured data for the types the research ties to AI visibility (Organization, Article,
// BreadcrumbList) and for FAQ/HowTo markup that doesn't match the visible page.
export function schemaFindings(p: SchemaPageInput): FindingInput[] {
  const f: FindingInput[] = [];
  const at = { url: p.url, layer: "geo" as const };
  const all = p.nodes.flatMap((n) => typesOf(n).map((t) => ({ t, n })));
  const of = (re: RegExp) => all.filter((x) => re.test(x.t)).map((x) => x.n);

  for (const org of p.isHomepage ? of(ORG) : []) {
    const missing = ["name", "url", "logo"].filter((k) => !has(org, k));
    if (missing.length) {
      f.push({ ...at, code: "organization_incomplete", severity: "low", evidence: "plausible", title: `Organization schema is missing ${missing.join(", ")}`, detail: "Complete name, url and logo give search and AI systems an unambiguous identity for your brand." });
    }
    if (!has(org, "sameAs")) {
      f.push({ ...at, code: "organization_no_sameas", severity: "medium", evidence: "plausible", title: "Organization schema has no sameAs links", detail: "sameAs links to your LinkedIn, Crunchbase or Wikidata profiles are how engines tell your brand apart from similarly named ones. Evidence for the effect on citations is directional, not experimentally proven." });
    }
  }

  for (const a of of(ARTICLE)) {
    const missing = ["headline", "author", "datePublished"].filter((k) => !has(a, k));
    if (missing.length) {
      f.push({ ...at, layer: "aeo", code: "article_incomplete", severity: "low", evidence: "plausible", title: `Article schema is missing ${missing.join(", ")}`, detail: "Visible authorship and dates support the trust signals Google's quality guidelines describe, and give answer engines something to attribute." });
    }
  }
  if (p.looksLikeArticle && of(ARTICLE).length === 0 && !p.isHomepage) {
    f.push({ ...at, layer: "aeo", code: "article_schema_missing", severity: "low", evidence: "plausible", title: "Article-style page has no Article schema", detail: "Article was among the most common types on cited pages in a large URL study, though a smaller audit found no lift once content quality was controlled for." });
  }

  for (const b of of(/^BreadcrumbList$/)) {
    if (!has(b, "itemListElement")) {
      f.push({ ...at, layer: "seo", code: "breadcrumb_empty", severity: "low", evidence: "proven", title: "BreadcrumbList has no items", detail: "An empty breadcrumb list is ignored by search engines. Add itemListElement entries or remove it." });
    }
  }

  // FAQ/HowTo markup that isn't visible on the page is the risky pattern, not FAQ markup itself.
  for (const faq of of(/^FAQPage$/)) {
    const qs = [faq.mainEntity].flat().filter((q): q is Node => !!q && typeof q === "object");
    if (qs.length === 0) {
      f.push({ ...at, code: "faq_empty", severity: "medium", evidence: "proven", title: "FAQPage schema has no questions", detail: "FAQPage requires mainEntity with Question items. Empty markup is ignored." });
      continue;
    }
    const unseen = qs.filter((q) => typeof q.name === "string" && !p.visibleText.includes(q.name.toLowerCase().replace(/\s+/g, " ").slice(0, 40)));
    if (unseen.length > 0) {
      f.push({ ...at, code: "faq_not_visible", severity: "medium", evidence: "plausible", title: `${unseen.length} of ${qs.length} FAQ questions in schema don't appear on the page`, detail: "Markup that doesn't match visible content breaks search engine guidelines and can be ignored or penalised. Show the questions on the page or remove them from the schema." });
    }
  }
  return f;
}

// Site-level: FAQPage sprayed across many pages is the pattern the research flags as risky.
export function faqSpamFinding(pageTypes: string[][]): FindingInput | null {
  const withFaq = pageTypes.filter((t) => t.includes("FAQPage")).length;
  if (withFaq < 5 || withFaq / pageTypes.length < 0.4) return null;
  return {
    layer: "aeo",
    code: "faq_schema_sitewide",
    severity: "low",
    evidence: "speculative",
    title: `FAQPage schema appears on ${withFaq} of ${pageTypes.length} pages`,
    detail: "Evidence that FAQ markup raises AI citations is contested: one study found a lift, an independent audit found slightly lower extraction. Keep it only on pages with real Q&A content.",
  };
}
