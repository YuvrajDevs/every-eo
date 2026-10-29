import * as cheerio from "cheerio";
import { db } from "@/lib/db";
import { safeFetch } from "@/lib/safe-fetch";
import { analyzeRobots, type FindingInput } from "@/worker/robots";
import { readSitemaps } from "@/worker/sitemap";
import { answerScore, answerSignals, type AnswerSignals } from "@/worker/answer";
import { checkReachability } from "@/worker/reachability";
import { detectPlatform, guidanceFor } from "@/lib/platforms";
import { hasRenderGap, renderCheck } from "@/worker/render";
import { faqSpamFinding, flattenJsonLd, schemaFindings } from "@/worker/schema";
import { measurePerformance, performanceFindings } from "@/worker/performance";

const CONCURRENCY = 4;
const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|json|xml|txt|zip|mp4|mp3|woff2?|ttf)$/i;
// Transactional and private pages block or vary for bots by design; auditing them creates false alarms.
const SKIP_PATHS = /\/(cart|carts|checkout|checkouts|account|accounts|login|logout|signin|sign-in|signup|sign-up|register|password|admin|wp-admin|wp-login\.php|search|orders)(\/|$)/i;
const SKIP_QUERY = /[?&](add-to-cart|variant|sort_by|filter|q|s)=/i;

type PageData = {
  url: string;
  statusCode: number;
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  h1: string | null;
  canonical: string | null;
  metaRobots: string | null;
  jsonLdTypes: string[];
  wordCount: number;
  links: string[];
  signals: AnswerSignals;
  answerScore: number;
  schemaFindings: FindingInput[];
  renderGap: boolean;
};

function sameSite(host: string, root: string) {
  const strip = (h: string) => h.replace(/^www\./, "");
  return strip(host) === strip(root);
}

function normalize(href: string, base: string, rootHost: string): string | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!sameSite(url.hostname, rootHost)) return null;
    if (SKIP_EXTENSIONS.test(url.pathname) || SKIP_PATHS.test(url.pathname) || SKIP_QUERY.test(url.search)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function collectJsonLdTypes(node: unknown, out: string[]) {
  if (Array.isArray(node)) return node.forEach((n) => collectJsonLdTypes(n, out));
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  if (typeof type === "string") out.push(type);
  if (Array.isArray(type)) type.forEach((t) => typeof t === "string" && out.push(t));
  if (obj["@graph"]) collectJsonLdTypes(obj["@graph"], out);
}

function parsePage(url: string, statusCode: number, html: string, rootHost: string, isHomepage: boolean): PageData {
  const $ = cheerio.load(html);
  const jsonLdTypes: string[] = [];
  const ldNodes: ReturnType<typeof flattenJsonLd> = [];
  const scriptCount = $("script[src]").length;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      collectJsonLdTypes(parsed, jsonLdTypes);
      flattenJsonLd(parsed, ldNodes);
    } catch {
      jsonLdTypes.push("(invalid JSON-LD)");
    }
  });
  const h1s = $("h1");
  const title = $("title").first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr("href") ?? null;
  const metaRobots = $('meta[name="robots"]').attr("content") ?? null;
  const links = $("a[href]")
    .map((_, el) => normalize($(el).attr("href") ?? "", url, rootHost))
    .get()
    .filter((l): l is string => Boolean(l));
  $("script, style, noscript").remove();
  const signals = answerSignals($, jsonLdTypes);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = text ? text.split(" ").length : 0;
  const path = new URL(url).pathname;

  return {
    url,
    statusCode,
    title,
    metaDescription,
    h1Count: h1s.length,
    h1: h1s.first().text().trim() || null,
    canonical,
    metaRobots,
    jsonLdTypes: [...new Set(jsonLdTypes)],
    wordCount,
    links,
    signals,
    answerScore: answerScore(signals),
    schemaFindings: schemaFindings({
      url,
      nodes: ldNodes,
      isHomepage,
      visibleText: text.toLowerCase(),
      wordCount,
      looksLikeArticle: /\/(blog|news|articles?|guides?|resources|posts?)\//i.test(path) && wordCount >= 400,
    }),
    // Little server-rendered text but many script bundles: bots that don't run JavaScript see an empty page.
    renderGap: statusCode < 400 && wordCount < 80 && scriptCount >= 5,
  };
}

function pageFindings(page: PageData, isHomepage: boolean): FindingInput[] {
  const f: FindingInput[] = [];
  const at = { url: page.url };
  if (page.statusCode >= 400) {
    f.push({ ...at, layer: "seo", code: "http_error", severity: "high", evidence: "proven", title: `Page returns HTTP ${page.statusCode}`, detail: "Broken pages can't rank or be cited. Fix the page or remove links pointing to it." });
    return f;
  }
  if (page.metaRobots?.toLowerCase().includes("noindex")) {
    f.push({ ...at, layer: "seo", code: "noindex", severity: "high", evidence: "proven", title: "Page is set to noindex", detail: "Search engines and AI search tools that rely on them will not include this page. Check this is intentional." });
  }
  if (!page.title) {
    f.push({ ...at, layer: "seo", code: "missing_title", severity: "high", evidence: "proven", title: "Missing page title", detail: "The <title> tag is the main label search engines and AI answers show for this page." });
  } else if (page.title.length > 65) {
    f.push({ ...at, layer: "seo", code: "title_too_long", severity: "low", evidence: "proven", title: `Title is ${page.title.length} characters`, detail: "Google usually cuts titles off around 60 characters. Put the most important words first." });
  }
  if (!page.metaDescription) {
    f.push({ ...at, layer: "seo", code: "missing_meta_description", severity: "medium", evidence: "proven", title: "Missing meta description", detail: "Without one, search engines pick their own snippet, which is often less clear about what the page offers." });
  } else if (page.metaDescription.length < 70 || page.metaDescription.length > 165) {
    f.push({ ...at, layer: "seo", code: "meta_description_length", severity: "low", evidence: "plausible", title: `Meta description is ${page.metaDescription.length} characters`, detail: "Aim for roughly 120–160 characters so the full summary shows in search results." });
  }
  if (page.h1Count === 0) {
    f.push({ ...at, layer: "aeo", code: "missing_h1", severity: "medium", evidence: "plausible", title: "No H1 heading", detail: "A single clear H1 helps search and answer engines understand what question or topic the page covers." });
  } else if (page.h1Count > 1) {
    f.push({ ...at, layer: "aeo", code: "multiple_h1", severity: "low", evidence: "plausible", title: `${page.h1Count} H1 headings`, detail: "Multiple H1s blur the page's main topic. Use one H1 and H2/H3 for sections." });
  }
  if (page.jsonLdTypes.includes("(invalid JSON-LD)")) {
    f.push({ ...at, layer: "aeo", code: "invalid_jsonld", severity: "medium", evidence: "proven", title: "Structured data contains invalid JSON", detail: "Search engines ignore structured data blocks that fail to parse." });
  }
  if (!isHomepage && page.wordCount < 200) {
    f.push({ ...at, layer: "aeo", code: "thin_content", severity: "low", evidence: "plausible", title: `Only ${page.wordCount} words on this page`, detail: "Very short pages rarely give an AI engine enough to quote. If this page should be found, add a clear explanation of its topic." });
  }
  if (isHomepage && !page.jsonLdTypes.some((t) => t === "Organization" || t === "LocalBusiness" || t.endsWith("Organization"))) {
    f.push({ ...at, layer: "geo", code: "no_organization_schema", severity: "medium", evidence: "plausible", title: "Homepage has no Organization schema", detail: "Organization markup with sameAs links to your profiles (LinkedIn, Crunchbase, Wikidata) helps search and AI systems recognize your brand as a distinct entity." });
  }
  return f;
}

const LOCAL_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$|\.test$/i;

export function isLocalHost(hostname: string) {
  return LOCAL_HOST.test(hostname);
}

const paths = (urls: string[]) => urls.slice(0, 4).map((u) => new URL(u).pathname).join(", ") + (urls.length > 4 ? "…" : "");

// Canonical problems are usually one sitewide setting, so they're reported once, not per page.
function canonicalFindings(ok: PageData[], rootHost: string): FindingInput[] {
  const local: string[] = [];
  const otherSite: string[] = [];
  const otherPage: string[] = [];
  const invalid: string[] = [];
  let example = "";
  for (const p of ok) {
    if (!p.canonical) continue;
    let canon: URL;
    try {
      canon = new URL(p.canonical, p.url);
    } catch {
      invalid.push(p.url);
      continue;
    }
    const strip = (u: URL) => `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
    if (isLocalHost(canon.hostname)) {
      local.push(p.url);
      example ||= canon.toString();
    } else if (!sameSite(canon.hostname, rootHost)) otherSite.push(p.url);
    else if (strip(canon) !== strip(new URL(p.url))) otherPage.push(p.url);
  }

  const f: FindingInput[] = [];
  if (local.length) {
    f.push({
      layer: "seo",
      code: "canonical_localhost",
      severity: "high",
      evidence: "proven",
      title: `${local.length} pages tell search engines their real address is a development server`,
      detail: `Canonical tags point to ${example}, which only exists on a developer's computer. Search engines may refuse to index these pages or treat them as duplicates. This usually means a "site URL" environment setting was never set to your live domain. Pages: ${paths(local)}.`,
      url: local[0],
    });
  }
  if (otherSite.length) {
    f.push({ layer: "seo", code: "canonical_other_site", severity: "high", evidence: "proven", title: `${otherSite.length} pages point search engines to a different website`, detail: `Their canonical tags name another domain, so search engines credit that site instead of yours. Pages: ${paths(otherSite)}.`, url: otherSite[0] });
  }
  if (otherPage.length) {
    f.push({ layer: "seo", code: "canonical_elsewhere", severity: "info", evidence: "proven", title: `${otherPage.length} pages point search engines to a different URL on your site`, detail: `Fine for duplicate pages; a problem if these are pages you want found: ${paths(otherPage)}.`, url: otherPage[0] });
  }
  if (invalid.length) {
    f.push({ layer: "seo", code: "canonical_invalid", severity: "medium", evidence: "proven", title: `${invalid.length} pages have an unreadable canonical tag`, detail: `Search engines ignore canonical tags they can't parse: ${paths(invalid)}.`, url: invalid[0] });
  }
  return f;
}

function siteFindings(pages: PageData[], rootHost: string): FindingInput[] {
  const ok = pages.filter((p) => p.statusCode < 400);
  const f: FindingInput[] = canonicalFindings(ok, rootHost);

  const byTitle = new Map<string, PageData[]>();
  for (const p of ok) if (p.title) byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p]);
  for (const [title, group] of byTitle) {
    if (group.length < 2) continue;
    f.push({
      layer: "seo",
      code: "duplicate_title",
      severity: "medium",
      evidence: "proven",
      title: `${group.length} pages share the title "${title.slice(0, 60)}"`,
      detail: `Search engines and AI answers can't tell these pages apart: ${group.slice(0, 4).map((p) => new URL(p.url).pathname).join(", ")}${group.length > 4 ? "…" : ""}. Give each a unique title.`,
      url: group[0].url,
    });
  }

  const content = ok.filter((p) => p.wordCount >= 200);
  if (content.length > 0) {
    const avg = Math.round(content.reduce((n, p) => n + p.answerScore, 0) / content.length);
    const worst = [...content].sort((a, b) => a.answerScore - b.answerScore).slice(0, 5);
    if (avg < 50) {
      f.push({
        layer: "aeo",
        code: "low_answer_readiness",
        severity: "medium",
        evidence: "plausible",
        title: `Content is hard for AI to quote (answer readiness ${avg}/100)`,
        detail: `AI engines lift short, direct passages. Start pages with a 1–3 sentence answer, use question-style headings, add lists or tables, and include specific numbers with sources. Weakest pages: ${worst.map((p) => new URL(p.url).pathname).join(", ")}.`,
      });
    }
    const noStats = content.filter((p) => p.signals.statCount === 0).length;
    if (noStats / content.length > 0.6) {
      f.push({
        layer: "geo",
        code: "few_statistics",
        severity: "low",
        evidence: "plausible",
        title: `${noStats} of ${content.length} content pages have no specific numbers`,
        detail: "A 2024 study of generative engines (Aggarwal et al., KDD) found adding statistics and cited sources was among the most effective ways to get quoted. Add concrete figures with where they came from.",
      });
    }
  }
  return f;
}

// Low-impact issues repeated on many pages are one fix, so show them as one finding.
const COLLAPSIBLE: Record<string, string> = {
  title_too_long: "pages have titles longer than about 60 characters",
  meta_description_length: "pages have a meta description outside 120–160 characters",
  missing_meta_description: "pages have no meta description",
  thin_content: "pages have fewer than 200 words",
  multiple_h1: "pages have more than one H1 heading",
  missing_h1: "pages have no H1 heading",
};

function collapseRepeats(findings: FindingInput[]): FindingInput[] {
  const out: FindingInput[] = [];
  const groups = new Map<string, FindingInput[]>();
  for (const f of findings) {
    if (COLLAPSIBLE[f.code]) groups.set(f.code, [...(groups.get(f.code) ?? []), f]);
    else out.push(f);
  }
  for (const [code, group] of groups) {
    if (group.length < 3) {
      out.push(...group);
      continue;
    }
    const urls = group.flatMap((g) => (g.url ? [g.url] : []));
    out.push({ ...group[0], title: `${group.length} ${COLLAPSIBLE[code]}`, detail: `${group[0].detail} Affected: ${paths(urls)}.` });
  }
  return out;
}

export async function runCrawl(crawlId: string) {
  await db.$transaction([
    db.page.deleteMany({ where: { crawlId } }),
    db.finding.deleteMany({ where: { crawlId } }),
    db.robotsReport.deleteMany({ where: { crawlId } }),
  ]);
  const crawl = await db.crawl.update({
    where: { id: crawlId },
    data: { status: "running", startedAt: new Date(), error: null, performance: null },
    include: { domain: true },
  });
  const rootHost = crawl.domain.hostname;

  let origin = `https://${rootHost}`;
  let first;
  try {
    first = await safeFetch(`${origin}/`);
  } catch {
    origin = `http://${rootHost}`;
    first = await safeFetch(`${origin}/`);
  }
  origin = new URL(first.finalUrl).origin;
  const platform = detectPlatform(first.body, first.headers);
  const homepageUrl = first.finalUrl;

  const [robots, perf] = await Promise.all([analyzeRobots(origin), measurePerformance(homepageUrl)]);
  const reach = await checkReachability(homepageUrl, robots.botAccess);
  const botAccess = robots.botAccess.map((b) => {
    const r = reach.results.find((x) => x.userAgent === b.userAgent);
    return r ? { ...b, reachable: !r.blocked, reachStatus: r.status } : b;
  });
  const sitemaps = await readSitemaps(origin, robots.sitemaps);

  await db.robotsReport.create({
    data: {
      crawlId,
      robotsUrl: robots.robotsUrl,
      httpStatus: robots.httpStatus,
      found: robots.found,
      sitemaps: sitemaps.found.join("\n") || robots.sitemaps.join("\n") || null,
      botAccess: JSON.stringify(botAccess),
    },
  });
  await db.crawl.update({ where: { id: crawlId }, data: { performance: JSON.stringify(perf), platform } });

  const findings: FindingInput[] = [...robots.findings, ...reach.findings, ...performanceFindings(perf)];
  const badSitemaps = robots.sitemaps.filter((s) => {
    try {
      const host = new URL(s).hostname;
      return isLocalHost(host) || !sameSite(host, rootHost);
    } catch {
      return true;
    }
  });
  if (badSitemaps.length > 0) {
    findings.push({
      layer: "seo",
      code: "sitemap_wrong_host",
      severity: "high",
      evidence: "proven",
      title: "robots.txt points crawlers to a sitemap they can't reach",
      detail: `Your robots.txt lists ${badSitemaps.join(", ")}. Crawlers can't open that address, so they never see your sitemap. Change it to your live domain.`,
      url: robots.robotsUrl,
    });
  }
  const foreignEntries = sitemaps.urls.filter((u) => {
    try {
      const host = new URL(u).hostname;
      return isLocalHost(host) || !sameSite(host, rootHost);
    } catch {
      return true;
    }
  });
  if (foreignEntries.length > 0) {
    findings.push({
      layer: "seo",
      code: "sitemap_entries_wrong_host",
      severity: "high",
      evidence: "proven",
      title: `${foreignEntries.length} of ${sitemaps.urls.length} sitemap entries point to the wrong address`,
      detail: `Your sitemap lists pages like ${foreignEntries[0]} instead of your live domain, so search engines can't use it to find your pages. This usually comes from the same unset "site URL" setting.`,
      url: sitemaps.found[0],
    });
  }
  if (sitemaps.found.length === 0) {
    findings.push({ layer: "seo", code: "no_sitemap", severity: "medium", evidence: "proven", title: "No XML sitemap found", detail: "A sitemap lists every page you want found, so search engines and AI crawlers don't have to discover them through links alone.", url: new URL("/sitemap.xml", origin).toString() });
  }

  const pages: PageData[] = [];
  const seen = new Set<string>([homepageUrl]);
  const processed = new Set<string>();
  const queue: string[] = [];
  for (const u of sitemaps.urls) {
    const n = normalize(u, origin, rootHost);
    if (n && !seen.has(n)) {
      seen.add(n);
      queue.push(n);
    }
  }
  const sitemapSet = new Set(queue);

  const handle = async (url: string, prefetched?: Awaited<ReturnType<typeof safeFetch>>) => {
    let res;
    try {
      res = prefetched ?? (await safeFetch(url));
    } catch {
      return;
    }
    if (!res.contentType.includes("text/html")) return;
    if (!sameSite(new URL(res.finalUrl).hostname, rootHost)) return;
    if (processed.has(res.finalUrl)) return;
    processed.add(res.finalUrl);
    const page = parsePage(res.finalUrl, res.status, res.body, rootHost, url === homepageUrl);
    pages.push(page);
    await db.page.create({
      data: {
        crawlId,
        url: page.url,
        statusCode: page.statusCode,
        title: page.title,
        metaDescription: page.metaDescription,
        h1Count: page.h1Count,
        h1: page.h1,
        canonical: page.canonical,
        metaRobots: page.metaRobots,
        jsonLdCount: page.jsonLdTypes.length,
        jsonLdTypes: page.jsonLdTypes.join(",") || null,
        wordCount: page.wordCount,
        answerScore: page.statusCode < 400 ? page.answerScore : null,
        answerSignals: JSON.stringify(page.signals),
      },
    });
    findings.push(...pageFindings(page, url === homepageUrl), ...page.schemaFindings);
    for (const link of page.links) {
      if (!seen.has(link)) {
        seen.add(link);
        queue.push(link);
      }
    }
  };

  await handle(homepageUrl, first);
  while (queue.length > 0 && pages.length < crawl.maxPages) {
    const batch = queue.splice(0, Math.min(CONCURRENCY, crawl.maxPages - pages.length));
    await Promise.all(batch.map((u) => handle(u)));
    await db.crawl.update({ where: { id: crawlId }, data: { pagesCount: pages.length } });
  }

  findings.push(...siteFindings(pages, rootHost));
  const faqSpam = faqSpamFinding(pages.map((p) => p.jsonLdTypes));
  if (faqSpam) findings.push(faqSpam);
  // Measure suspected JS-only pages in a real browser; fall back to the HTML heuristic if none is installed.
  const suspects = pages.filter((p) => p.statusCode < 400 && (p.url === homepageUrl || p.renderGap)).slice(0, 4);
  const rendered = await renderCheck(suspects.map((p) => ({ url: p.url, rawWords: p.wordCount })));
  const gap = rendered ? rendered.filter(hasRenderGap) : suspects.filter((p) => p.renderGap).map((p) => ({ url: p.url, rawWords: p.wordCount, renderedWords: 0 }));
  if (gap.length > 0) {
    const example = gap[0];
    findings.push({
      layer: "geo",
      code: "js_render_gap",
      severity: "high",
      evidence: "plausible",
      title: `${gap.length} ${gap.length === 1 ? "page is" : "pages are"} mostly empty without JavaScript`,
      detail: rendered
        ? `In a real browser ${paths([example.url])} shows ${example.renderedWords} words, but the raw HTML contains only ${example.rawWords}. Crawlers that don't run JavaScript see the short version. Server-render your main content. Affected: ${paths(gap.map((g) => g.url))}.`
        : `These pages ship almost no text in the HTML and rely on scripts to build content: ${paths(gap.map((g) => g.url))}. Several AI crawlers don't run JavaScript, so they may see a blank page. Server-render the main content.`,
      url: example.url,
    });
  }
  const linkedFromSite = new Set(pages.flatMap((p) => p.links));
  const orphans = [...sitemapSet].filter((u) => processed.has(u) && !linkedFromSite.has(u));
  if (orphans.length > 0) {
    findings.push({
      layer: "seo",
      code: "orphan_pages",
      severity: "low",
      evidence: "plausible",
      title: `${orphans.length} pages are in your sitemap but no page links to them`,
      detail: `Crawlers find and value pages through internal links. Link to these from relevant pages: ${orphans.slice(0, 4).map((u) => new URL(u).pathname).join(", ")}${orphans.length > 4 ? "…" : ""}.`,
    });
  }

  await db.finding.createMany({
    data: collapseRepeats(findings).map((f) => {
      const g = guidanceFor(platform, f.code);
      return { ...f, crawlId, fixability: g?.fixability ?? "you", howTo: g?.howTo ?? null };
    }),
  });
  await db.apiCallLog.createMany({
    data: [
      { orgId: crawl.orgId, provider: "crawl", operation: "page_fetch", units: pages.length + 1, costMicros: 0 },
      { orgId: crawl.orgId, provider: "psi", operation: "pagespeed_mobile", units: 1, costMicros: 0 },
    ],
  });
  await db.crawl.update({
    where: { id: crawlId },
    data: { status: "completed", pagesCount: pages.length, finishedAt: new Date() },
  });
}
