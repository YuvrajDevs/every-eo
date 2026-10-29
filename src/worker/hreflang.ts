import type { FindingInput } from "@/worker/robots";
import { validHreflang } from "@/lib/markets";

export type Alternate = { lang: string; href: string };
type PageAlts = { url: string; statusCode: number; hreflang: Alternate[] };

const norm = (u: string) => {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
};
const paths = (urls: string[]) => urls.slice(0, 4).map((u) => new URL(u).pathname).join(", ") + (urls.length > 4 ? "…" : "");

// Search engines only trust hreflang that's valid, includes the page itself, and is confirmed by the other page.
export function hreflangFindings(pages: PageAlts[]): FindingInput[] {
  const withAlts = pages.filter((p) => p.statusCode < 400 && p.hreflang.length > 0);
  if (withAlts.length === 0) return [];
  const byUrl = new Map(pages.map((p) => [norm(p.url), p]));
  const invalid: string[] = [];
  const noSelf: string[] = [];
  const noReturn: string[] = [];
  const badTarget: string[] = [];
  let missingDefault = 0;

  for (const p of withAlts) {
    if (p.hreflang.some((a) => !validHreflang(a.lang))) invalid.push(p.url);
    if (!p.hreflang.some((a) => norm(a.href) === norm(p.url))) noSelf.push(p.url);
    if (!p.hreflang.some((a) => a.lang.toLowerCase() === "x-default")) missingDefault++;
    for (const a of p.hreflang) {
      const target = byUrl.get(norm(a.href));
      if (!target || norm(a.href) === norm(p.url)) continue; // only judge pages we crawled
      if (target.statusCode >= 400) badTarget.push(p.url);
      else if (!target.hreflang.some((b) => norm(b.href) === norm(p.url))) noReturn.push(p.url);
    }
  }
  const uniq = (xs: string[]) => [...new Set(xs)];
  const f: FindingInput[] = [];
  if (invalid.length) f.push({ layer: "seo", code: "hreflang_invalid", severity: "medium", evidence: "proven", title: `${uniq(invalid).length} pages use invalid hreflang codes`, detail: `Use language codes like "de" or "de-AT" (ISO 639-1, optional ISO 3166 region) or "x-default". Invalid values are ignored. Pages: ${paths(uniq(invalid))}.`, url: invalid[0] });
  if (noReturn.length) f.push({ layer: "seo", code: "hreflang_no_return", severity: "medium", evidence: "proven", title: `${uniq(noReturn).length} pages point to language versions that don't point back`, detail: `hreflang links must be reciprocal; one-way links are ignored, so the wrong language version may be shown. Pages: ${paths(uniq(noReturn))}.`, url: noReturn[0] });
  if (badTarget.length) f.push({ layer: "seo", code: "hreflang_broken_target", severity: "high", evidence: "proven", title: `${uniq(badTarget).length} pages list a language version that returns an error`, detail: `Fix or remove those alternates. Pages: ${paths(uniq(badTarget))}.`, url: badTarget[0] });
  if (noSelf.length) f.push({ layer: "seo", code: "hreflang_no_self", severity: "low", evidence: "proven", title: `${noSelf.length} pages' hreflang sets don't include the page itself`, detail: `Each language version should list itself as well as the others. Pages: ${paths(noSelf)}.`, url: noSelf[0] });
  if (missingDefault === withAlts.length) f.push({ layer: "seo", code: "hreflang_no_x_default", severity: "low", evidence: "plausible", title: "No x-default language version", detail: "An x-default alternate tells engines which page to show people whose language you don't target." });
  return f;
}
