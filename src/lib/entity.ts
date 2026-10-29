import { z } from "zod";

// Builds the structured data and profile drafts that make a brand and its authors recognisable entities.
// Everything here is deterministic so it can be previewed, applied by the fix engine, and tested.

const PROFILE_HOSTS: { host: RegExp; label: string; wikidata?: { prop: string; id: (u: URL) => string | null } }[] = [
  { host: /(^|\.)linkedin\.com$/, label: "LinkedIn", wikidata: { prop: "P4264", id: (u) => u.pathname.match(/^\/company\/([^/]+)/)?.[1] ?? null } },
  { host: /(^|\.)crunchbase\.com$/, label: "Crunchbase", wikidata: { prop: "P2088", id: (u) => u.pathname.match(/^\/organization\/([^/]+)/)?.[1] ?? null } },
  { host: /(^|\.)wikidata\.org$/, label: "Wikidata" },
  { host: /(^|\.)wikipedia\.org$/, label: "Wikipedia" },
  { host: /(^|\.)(x|twitter)\.com$/, label: "X / Twitter", wikidata: { prop: "P2002", id: (u) => u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)?.[1] ?? null } },
  { host: /(^|\.)facebook\.com$/, label: "Facebook", wikidata: { prop: "P2013", id: (u) => u.pathname.match(/^\/([^/]+)\/?$/)?.[1] ?? null } },
  { host: /(^|\.)instagram\.com$/, label: "Instagram", wikidata: { prop: "P2003", id: (u) => u.pathname.match(/^\/([^/]+)\/?$/)?.[1] ?? null } },
  { host: /(^|\.)youtube\.com$/, label: "YouTube", wikidata: { prop: "P2397", id: (u) => u.pathname.match(/^\/channel\/(UC[\w-]{22})/)?.[1] ?? null } },
  { host: /(^|\.)github\.com$/, label: "GitHub", wikidata: { prop: "P2037", id: (u) => u.pathname.match(/^\/([^/]+)\/?$/)?.[1] ?? null } },
  { host: /(^|\.)g2\.com$/, label: "G2" },
  { host: /(^|\.)capterra\.com$/, label: "Capterra" },
  { host: /(^|\.)trustpilot\.com$/, label: "Trustpilot" },
  { host: /(^|\.)producthunt\.com$/, label: "Product Hunt" },
];

export function profileLabel(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PROFILE_HOSTS.find((p) => p.host.test(host))?.label ?? host;
  } catch {
    return null;
  }
}

const httpsUrl = z
  .string()
  .trim()
  .transform((s, ctx) => {
    try {
      const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      u.hash = "";
      return u.toString().replace(/\/$/, "");
    } catch {
      ctx.addIssue({ code: "custom", message: `"${s}" isn't a valid web address` });
      return z.NEVER;
    }
  });

const optional = <T extends z.ZodTypeAny>(s: T) => z.union([z.literal("").transform(() => undefined), s]).optional();

export const personSchema = z.object({
  name: z.string().trim().min(2, "Author name is required").max(100),
  jobTitle: optional(z.string().trim().max(100)),
  url: optional(httpsUrl),
  image: optional(httpsUrl),
  bio: optional(z.string().trim().max(1000)),
  knowsAbout: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  sameAs: z.array(httpsUrl).max(15).default([]),
});

export const entitySchema = z.object({
  name: z.string().trim().min(2, "Organisation name is required").max(120),
  legalName: optional(z.string().trim().max(160)),
  url: httpsUrl,
  logo: optional(httpsUrl),
  description: optional(z.string().trim().max(500)),
  foundingDate: optional(z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "Use YYYY, YYYY-MM or YYYY-MM-DD")),
  email: optional(z.email("Enter a valid email")),
  telephone: optional(z.string().trim().max(40)),
  sameAs: z.array(httpsUrl).max(20).default([]),
  authors: z.array(personSchema).max(20).default([]),
});

export type EntityProfile = z.infer<typeof entitySchema>;
export type Person = z.infer<typeof personSchema>;

const dedupe = (urls: string[]) => [...new Set(urls)];

export function organizationJsonLd(e: EntityProfile) {
  const id = `${e.url}/#organization`;
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": id,
    name: e.name,
    ...(e.legalName && { legalName: e.legalName }),
    url: e.url,
    ...(e.logo && { logo: { "@type": "ImageObject", url: e.logo } }),
    ...(e.description && { description: e.description }),
    ...(e.foundingDate && { foundingDate: e.foundingDate }),
    ...((e.email || e.telephone) && {
      contactPoint: { "@type": "ContactPoint", contactType: "customer support", ...(e.email && { email: e.email }), ...(e.telephone && { telephone: e.telephone }) },
    }),
    ...(e.sameAs.length && { sameAs: dedupe(e.sameAs) }),
  };
}

export function personJsonLd(p: Person, org: EntityProfile) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    ...(p.url && { "@id": `${p.url}#person` }),
    name: p.name,
    ...(p.jobTitle && { jobTitle: p.jobTitle }),
    ...(p.url && { url: p.url }),
    ...(p.image && { image: p.image }),
    ...(p.bio && { description: p.bio }),
    ...(p.knowsAbout.length && { knowsAbout: p.knowsAbout }),
    worksFor: { "@id": `${org.url}/#organization` },
    ...(p.sameAs.length && { sameAs: dedupe(p.sameAs) }),
  };
}

export function articleJsonLd(a: { url: string; headline: string; datePublished?: string; dateModified?: string; image?: string }, author: Person | null, org: EntityProfile) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.headline.slice(0, 110),
    mainEntityOfPage: a.url,
    ...(a.datePublished && { datePublished: a.datePublished }),
    ...(a.dateModified && { dateModified: a.dateModified }),
    ...(a.image && { image: a.image }),
    ...(author && { author: { "@type": "Person", name: author.name, ...(author.url && { url: author.url }) } }),
    publisher: { "@id": `${org.url}/#organization` },
  };
}

export function breadcrumbJsonLd(pageUrl: string, names: string[]) {
  const u = new URL(pageUrl);
  const parts = u.pathname.split("/").filter(Boolean);
  const items = [{ name: names[0] ?? "Home", url: `${u.origin}/` }];
  parts.forEach((_, i) => items.push({ name: names[i + 1] ?? decodeURIComponent(parts[i]).replace(/[-_]+/g, " "), url: `${u.origin}/${parts.slice(0, i + 1).join("/")}${i === parts.length - 1 && u.pathname.endsWith("/") ? "/" : ""}` }));
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Visible author box: E-E-A-T is about what readers (and raters) can see, not only markup.
export function authorBioHtml(p: Person) {
  const links = p.sameAs.map((u) => `<a href="${escapeHtml(u)}" rel="me noopener">${escapeHtml(profileLabel(u) ?? u)}</a>`).join(" · ");
  return [
    `<aside class="author-bio" itemscope itemtype="https://schema.org/Person">`,
    p.image ? `  <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" width="96" height="96" loading="lazy">` : null,
    `  <p><strong itemprop="name">${escapeHtml(p.name)}</strong>${p.jobTitle ? `, <span itemprop="jobTitle">${escapeHtml(p.jobTitle)}</span>` : ""}</p>`,
    p.bio ? `  <p itemprop="description">${escapeHtml(p.bio)}</p>` : null,
    p.knowsAbout.length ? `  <p>Writes about: ${p.knowsAbout.map(escapeHtml).join(", ")}</p>` : null,
    links ? `  <p>${links}</p>` : null,
    `</aside>`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Script tag for copy-paste into builders that accept head code. "</" is escaped so text can't close the tag.
export function scriptTag(jsonLd: object) {
  return `<script type="application/ld+json">${JSON.stringify(jsonLd, null, 2).replace(/<\//g, "<\\/")}</script>`;
}

// QuickStatements (v1) draft for creating a Wikidata item. It is a starting point to review, not an auto-submit:
// Wikidata expects notability and references, and a rejected item is worse than none.
export function wikidataQuickStatements(e: EntityProfile) {
  const q = (s: string) => `"${s.replace(/"/g, "'")}"`;
  const lines = ["CREATE", `LAST\tLen\t${q(e.name)}`];
  if (e.description) lines.push(`LAST\tDen\t${q(e.description.slice(0, 250))}`);
  lines.push("LAST\tP31\tQ4830453"); // instance of: business
  lines.push(`LAST\tP856\t${q(e.url)}`); // official website
  if (e.foundingDate) {
    const [y, m, d] = e.foundingDate.split("-");
    const precision = d ? 11 : m ? 10 : 9;
    lines.push(`LAST\tP571\t+${y}-${m ?? "01"}-${d ?? "01"}T00:00:00Z/${precision}`); // inception
  }
  for (const s of e.sameAs) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      continue;
    }
    const known = PROFILE_HOSTS.find((p) => p.host.test(u.hostname.toLowerCase()));
    const id = known?.wikidata?.id(u);
    if (known?.wikidata && id) lines.push(`LAST\t${known.wikidata.prop}\t${q(decodeURIComponent(id))}`);
  }
  return lines.join("\n");
}

export function entityChecklist(e: EntityProfile) {
  const labels = new Set(e.sameAs.map((u) => profileLabel(u)));
  const has = (l: string) => labels.has(l);
  return [
    { done: Boolean(e.logo), label: "Logo URL set (used in Organization schema)" },
    { done: Boolean(e.description), label: "One-sentence description of what you do" },
    { done: has("LinkedIn"), label: "LinkedIn company page linked" },
    { done: has("Crunchbase"), label: "Crunchbase profile linked" },
    { done: has("Wikidata"), label: "Wikidata item linked (draft below if you don't have one)" },
    { done: has("G2") || has("Capterra") || has("Trustpilot"), label: "At least one review-site profile (G2, Capterra or Trustpilot) linked" },
    { done: e.authors.length > 0, label: "At least one author with a bio" },
    { done: e.authors.some((a) => a.sameAs.length > 0), label: "Authors link to their own profiles" },
  ];
}
