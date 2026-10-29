import * as cheerio from "cheerio";
import { safeFetch } from "@/lib/safe-fetch";

const MAX_URLS = 500;
const MAX_CHILD_SITEMAPS = 5;

function locs(xml: string) {
  const $ = cheerio.load(xml, { xml: true });
  return {
    childSitemaps: $("sitemapindex > sitemap > loc").map((_, el) => $(el).text().trim()).get(),
    pages: $("urlset > url > loc").map((_, el) => $(el).text().trim()).get(),
  };
}

// Reads sitemap URLs (following one level of sitemap index) so pages nothing links to still get audited.
export async function readSitemaps(origin: string, declared: string[]): Promise<{ found: string[]; urls: string[] }> {
  const fallback = new URL("/sitemap.xml", origin).toString();
  const candidates = [...new Set([...declared, fallback])];
  const found: string[] = [];
  const urls = new Set<string>();

  const load = async (sitemapUrl: string) => {
    try {
      const res = await safeFetch(sitemapUrl);
      if (res.status !== 200 || !res.body.includes("<")) return null;
      found.push(sitemapUrl);
      return locs(res.body);
    } catch {
      return null;
    }
  };

  for (const sitemapUrl of candidates.slice(0, MAX_CHILD_SITEMAPS)) {
    if (sitemapUrl === fallback && found.length > 0) break;
    const parsed = await load(sitemapUrl);
    if (!parsed) continue;
    parsed.pages.forEach((u) => urls.size < MAX_URLS && urls.add(u));
    for (const child of parsed.childSitemaps.slice(0, MAX_CHILD_SITEMAPS)) {
      if (urls.size >= MAX_URLS) break;
      const sub = await load(child);
      sub?.pages.forEach((u) => urls.size < MAX_URLS && urls.add(u));
    }
  }
  return { found, urls: [...urls] };
}
