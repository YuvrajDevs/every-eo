// Which site builder runs a site, and what its owner can actually change there.
// Menu names drift as builders redesign their dashboards, so instructions say where to look, not exact click paths.

export type PlatformId = "wordpress" | "shopify" | "wix" | "squarespace" | "webflow" | "ghost" | "hubspot" | "framer" | "unknown";

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  wordpress: "WordPress",
  shopify: "Shopify",
  wix: "Wix",
  squarespace: "Squarespace",
  webflow: "Webflow",
  ghost: "Ghost",
  hubspot: "HubSpot CMS",
  framer: "Framer",
  unknown: "Custom or unknown",
};

const SIGNALS: [PlatformId, RegExp[], RegExp[]][] = [
  // [platform, HTML patterns, header patterns ("name: value")]
  ["wix", [/<meta[^>]+generator[^>]+Wix\.com/i, /static\.wixstatic\.com|static\.parastorage\.com/i], [/^x-wix-request-id:/im]],
  ["squarespace", [/This is Squarespace\./i, /static1\.squarespace\.com|assets\.squarespace\.com/i], [/^server: squarespace/im]],
  ["webflow", [/<html[^>]+data-wf-(site|page)=/i, /<meta[^>]+generator[^>]+Webflow/i], []],
  ["shopify", [/cdn\.shopify\.com/i, /Shopify\.theme\s*=/], [/^x-shopid:/im, /^powered-by: shopify/im]],
  ["ghost", [/<meta[^>]+generator[^>]+Ghost/i], []],
  ["hubspot", [/<meta[^>]+generator[^>]+HubSpot/i, /js\.hs-scripts\.com/i], []],
  ["framer", [/<meta[^>]+generator[^>]+Framer/i, /framerusercontent\.com/i], []],
  ["wordpress", [/<meta[^>]+generator[^>]+WordPress/i, /\/wp-content\/|\/wp-includes\//i, /<link[^>]+rel=["']https:\/\/api\.w\.org\/["']/i], [/^link: <[^>]*\/wp-json\/>/im]],
];

export function detectPlatform(html: string, headers: Record<string, string>): PlatformId {
  const headerText = Object.entries(headers)
    .map(([k, v]) => `${k.toLowerCase()}: ${v}`)
    .join("\n");
  const head = html.slice(0, 200_000);
  let best: { id: PlatformId; score: number } = { id: "unknown", score: 0 };
  for (const [id, htmlRes, headerRes] of SIGNALS) {
    const score = htmlRes.filter((r) => r.test(head)).length + headerRes.filter((r) => r.test(headerText)).length * 2;
    if (score > best.score) best = { id, score };
  }
  return best.id;
}

// you: the owner edits it directly. setting: a dashboard option controls it. platform: the builder decides; the owner can't change it.
export type Fixability = "you" | "setting" | "platform";
export type Guidance = { fixability: Fixability; howTo: string };

type Family = "robots" | "ai_block" | "sitemap" | "canonical" | "title" | "meta" | "headings" | "schema" | "content" | "speed" | "firewall" | "render" | "status";

export function findingFamily(code: string): Family | null {
  if (code.startsWith("bot_blocked_") || code === "robots_missing" || code === "robots_no_sitemap") return "robots";
  if (code.startsWith("bot_training_optout_")) return "ai_block";
  if (code.startsWith("firewall_blocks_")) return "firewall";
  if (code.startsWith("sitemap") || code === "no_sitemap") return "sitemap";
  if (code.startsWith("canonical")) return "canonical";
  if (code === "missing_title" || code === "title_too_long" || code === "duplicate_title") return "title";
  if (code === "missing_meta_description" || code === "meta_description_length") return "meta";
  if (code === "missing_h1" || code === "multiple_h1") return "headings";
  if (/schema|jsonld|organization_|article_|breadcrumb_|faq_/.test(code)) return "schema";
  if (["thin_content", "low_answer_readiness", "few_statistics", "orphan_pages"].includes(code)) return "content";
  if (code.startsWith("perf_") || code.includes("lcp") || code.includes("cls") || code.includes("speed")) return "speed";
  if (code === "js_render_gap") return "render";
  if (code === "http_error" || code === "noindex") return "status";
  return null;
}

const CHECK = "Menu names change; if you can't find it, search your dashboard's help for the term in quotes.";

const GUIDE: Partial<Record<PlatformId, Partial<Record<Family, Guidance>>>> = {
  wix: {
    robots: { fixability: "setting", howTo: `Wix generates robots.txt. Edit it in your site's SEO settings ("robots.txt editor"). ${CHECK}` },
    ai_block: { fixability: "setting", howTo: `Change it in the robots.txt editor in your SEO settings if you want to allow training crawlers. ${CHECK}` },
    sitemap: { fixability: "platform", howTo: "Wix creates and submits your sitemap automatically. If pages are missing, check each page is set to be indexed in its SEO settings." },
    canonical: { fixability: "setting", howTo: `Wix sets canonical tags automatically. You can override one per page in that page's advanced SEO settings. ${CHECK}` },
    title: { fixability: "you", howTo: "Edit the title in the page's SEO settings (\"title tag\"). For store or blog items, set it on the item's SEO tab." },
    meta: { fixability: "you", howTo: "Edit the meta description in the page's SEO settings." },
    headings: { fixability: "you", howTo: "In the editor, select the text and set its style to Heading 1 / Heading 2. Wix uses the text style as the heading level." },
    schema: { fixability: "you", howTo: `Add JSON-LD in the page's advanced SEO settings ("structured data markup"). Paste the generated code from this report. ${CHECK}` },
    speed: { fixability: "platform", howTo: "Wix controls hosting and most scripts. Reduce heavy images, video backgrounds and third-party apps on the page." },
    firewall: { fixability: "platform", howTo: "Wix's own network answered this bot. You can't change Wix's firewall; if it persists, contact Wix support with the bot name." },
    render: { fixability: "platform", howTo: "Wix renders pages on its servers for most content. Content inside custom code or some apps may still need JavaScript; move important text into normal text elements." },
  },
  squarespace: {
    robots: { fixability: "platform", howTo: "Squarespace generates robots.txt and doesn't let you edit it. If a search bot is blocked, check the crawler settings (\"artificial intelligence crawlers\" / search engine indexing) and page-level \"hide from search engines\" options." },
    ai_block: { fixability: "setting", howTo: `Squarespace has a site-wide setting that blocks known AI crawlers. Turn it off in your crawler settings if you want to allow them. ${CHECK}` },
    sitemap: { fixability: "platform", howTo: "Squarespace creates your sitemap automatically at /sitemap.xml." },
    canonical: { fixability: "platform", howTo: "Squarespace sets canonical tags automatically. Make sure your primary domain is set correctly in your domain settings." },
    title: { fixability: "you", howTo: "Edit the SEO title in the page's settings (SEO tab)." },
    meta: { fixability: "you", howTo: "Edit the SEO description in the page's settings (SEO tab)." },
    headings: { fixability: "you", howTo: "In a text block, set the paragraph style to Heading 1 / Heading 2." },
    schema: { fixability: "you", howTo: `Paste JSON-LD into page header code injection (page settings → Advanced) or site-wide code injection. Code injection may require a paid plan. ${CHECK}` },
    speed: { fixability: "platform", howTo: "Squarespace controls hosting. Compress images and remove unused blocks or embeds." },
    firewall: { fixability: "platform", howTo: "Squarespace's network answered this bot. Check the AI crawler setting first; otherwise contact Squarespace support." },
  },
  webflow: {
    robots: { fixability: "you", howTo: "Edit robots.txt in your site settings (SEO tab), then publish." },
    ai_block: { fixability: "you", howTo: "Edit robots.txt in your site settings (SEO tab) if you want to allow training crawlers, then publish." },
    sitemap: { fixability: "setting", howTo: "Turn on the auto-generated sitemap in your site settings (SEO tab), then publish." },
    canonical: { fixability: "setting", howTo: "Set the global canonical URL in site settings (SEO tab); individual pages can override it in page settings." },
    title: { fixability: "you", howTo: "Edit the title tag in the page's settings (SEO settings). For CMS pages, set it on the collection template." },
    meta: { fixability: "you", howTo: "Edit the meta description in the page's settings. For CMS pages, bind it to a collection field." },
    headings: { fixability: "you", howTo: "Select the element in the Designer and change its tag to H1/H2." },
    schema: { fixability: "you", howTo: "Paste JSON-LD into the page's custom code (inside <head>), or the CMS template for collection pages, then publish." },
    speed: { fixability: "you", howTo: "Compress images, lazy-load media below the fold, and remove unused interactions and custom scripts." },
    render: { fixability: "you", howTo: "Content loaded by custom JavaScript or embeds isn't in the HTML. Put important text in native Webflow elements." },
  },
  shopify: {
    robots: { fixability: "you", howTo: "Edit robots.txt by adding a robots.txt.liquid template to your theme (Online Store → Themes → Edit code)." },
    ai_block: { fixability: "you", howTo: "Adjust the rules in your theme's robots.txt.liquid template if you want to allow training crawlers." },
    sitemap: { fixability: "platform", howTo: "Shopify creates /sitemap.xml automatically." },
    canonical: { fixability: "platform", howTo: "Your theme outputs canonical tags. If they point elsewhere, check theme.liquid or ask your theme developer." },
    title: { fixability: "you", howTo: "Edit the page, product or collection's search engine listing (bottom of its admin page)." },
    meta: { fixability: "you", howTo: "Edit the description in the item's search engine listing section." },
    schema: { fixability: "you", howTo: "Install our Shopify app to inject schema automatically, or add JSON-LD to theme.liquid." },
    speed: { fixability: "you", howTo: "Remove unused apps (each adds scripts), compress images, and check your theme's speed report." },
  },
  wordpress: {
    robots: { fixability: "you", howTo: "Install our WordPress plugin to fix this automatically, or edit robots.txt in your SEO plugin." },
    ai_block: { fixability: "you", howTo: "Install our WordPress plugin to manage this, or edit robots.txt in your SEO plugin." },
    schema: { fixability: "you", howTo: "Install our WordPress plugin to apply the generated schema automatically." },
    title: { fixability: "you", howTo: "Install our WordPress plugin to apply suggested titles, or edit them in your SEO plugin." },
    meta: { fixability: "you", howTo: "Install our WordPress plugin to apply suggested descriptions, or edit them in your SEO plugin." },
  },
  ghost: {
    robots: { fixability: "you", howTo: "Add a robots.txt file to your theme's root folder and upload the theme." },
    sitemap: { fixability: "platform", howTo: "Ghost creates /sitemap.xml automatically." },
    schema: { fixability: "you", howTo: "Paste JSON-LD into Code injection (site header) or the post's code injection." },
  },
};

export function guidanceFor(platform: PlatformId, code: string): Guidance | null {
  const family = findingFamily(code);
  return family ? (GUIDE[platform]?.[family] ?? null) : null;
}
