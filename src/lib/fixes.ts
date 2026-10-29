import { createHash } from "node:crypto";
import { AI_BOTS } from "@/lib/ai-bots";
import { articleJsonLd, organizationJsonLd, type EntityProfile } from "@/lib/entity";

// Turns audit findings into concrete changes the WordPress connector can apply. Only fixes whose content can be
// derived from facts we already have are proposed; anything needing judgment (titles, copy) is left to the owner.

export type ProposedFix = {
  key: string;
  type: "jsonld" | "meta_description" | "robots_allow";
  findingCode: string;
  title: string;
  why: string;
  evidence: "proven" | "plausible" | "speculative";
  url?: string;
  sitewide?: boolean;
  payload: Record<string, unknown>;
  editableText?: boolean;
};

export type BlockedProposal = { findingCode: string; title: string; needs: "entity" };

type PageLite = { url: string; statusCode: number | null; title: string | null; h1: string | null; metaDescription: string | null; excerpt: string | null; metaRobots: string | null };
type FindingLite = { code: string; url: string | null };

export function remoteId(key: string) {
  return `v${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;
}

// Cuts to a full sentence when one fits, otherwise to a word boundary, aiming for ~120–155 characters.
export function suggestDescription(excerpt: string) {
  const text = excerpt.replace(/\s+/g, " ").trim();
  if (text.length <= 155) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = "";
  for (const s of sentences) {
    if ((out + s).trim().length > 155) break;
    out += s;
  }
  if (out.trim().length >= 70) return out.trim();
  const cut = text.slice(0, 152);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

const pathOf = (u: string) => {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
};

const cleanTitle = (t: string) => t.split(/\s[|–—-]\s/)[0].trim();

export function proposeFixes(input: { homepage: string; findings: FindingLite[]; pages: PageLite[]; entity: EntityProfile | null; hostname: string }) {
  const proposals: ProposedFix[] = [];
  const blocked: BlockedProposal[] = [];
  const codes = new Set(input.findings.map((f) => f.code));
  const org: EntityProfile = input.entity ?? { name: input.hostname.replace(/^www\./, ""), url: `https://${input.hostname}`, sameAs: [], authors: [] };

  const orgCode = ["no_organization_schema", "organization_no_sameas", "organization_incomplete"].find((c) => codes.has(c));
  if (orgCode) {
    if (input.entity) {
      proposals.push({
        key: "org-home",
        type: "jsonld",
        findingCode: orgCode,
        title: "Add complete Organization schema to the homepage",
        why: "Names your brand, logo and official profiles (sameAs) in one machine-readable block.",
        evidence: "plausible",
        url: input.homepage,
        payload: { data: organizationJsonLd(input.entity) },
      });
    } else {
      blocked.push({ findingCode: orgCode, title: "Organization schema", needs: "entity" });
    }
  }

  for (const f of input.findings.filter((x) => x.code === "article_schema_missing" && x.url)) {
    const page = input.pages.find((p) => p.url === f.url);
    const headline = page?.h1 || (page?.title ? cleanTitle(page.title) : null);
    if (!headline) continue;
    proposals.push({
      key: `article:${pathOf(f.url!)}`,
      type: "jsonld",
      findingCode: f.code,
      title: `Add Article schema to ${pathOf(f.url!)}`,
      why: "Identifies the page as an article with a headline, author and publisher.",
      evidence: "plausible",
      url: f.url!,
      payload: { data: articleJsonLd({ url: f.url!, headline }, org.authors[0] ?? null, org) },
    });
  }

  // Missing descriptions are collapsed into one finding in the report, so work from the pages themselves.
  if (codes.has("missing_meta_description")) {
    for (const p of input.pages) {
      if (p.metaDescription || !p.excerpt || (p.statusCode ?? 0) >= 400 || p.metaRobots?.includes("noindex")) continue;
      proposals.push({
        key: `meta:${pathOf(p.url)}`,
        type: "meta_description",
        findingCode: "missing_meta_description",
        title: `Add a meta description to ${pathOf(p.url)}`,
        why: "Suggested from the page's opening paragraph. Edit it before applying if it doesn't read well as a summary.",
        evidence: "proven",
        url: p.url,
        payload: { text: suggestDescription(p.excerpt) },
        editableText: true,
      });
    }
  }

  const blockedAgents = AI_BOTS.filter((b) => b.purpose !== "training" && codes.has(`bot_blocked_${b.userAgent.toLowerCase()}`)).map((b) => b.userAgent);
  if (blockedAgents.length) {
    proposals.push({
      key: "robots-allow",
      type: "robots_allow",
      findingCode: `bot_blocked_${blockedAgents[0].toLowerCase()}`,
      title: `Allow ${blockedAgents.join(", ")} in robots.txt`,
      why: "Search and answer crawlers must be allowed to read your pages before they can cite them. Training crawlers are left as they are.",
      evidence: "proven",
      sitewide: true,
      payload: { agents: blockedAgents },
    });
  }
  return { proposals, blocked };
}
