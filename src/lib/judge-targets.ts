import { MAX_JUDGE_PAGES, questionFor } from "@/lib/judge";

type PageLite = { url: string; statusCode: number | null; wordCount: number; title: string | null; h1: string | null; headings: string | null; metaRobots: string | null };

// The longest healthy content pages, each with the question it should answer. Page text is roughly words × 6 chars.
export function judgeTargets(pages: PageLite[], tracked: string[]) {
  return pages
    .filter((p) => (p.statusCode ?? 0) < 400 && p.wordCount >= 200 && !p.metaRobots?.includes("noindex"))
    .sort((a, b) => b.wordCount - a.wordCount)
    .slice(0, MAX_JUDGE_PAGES)
    .flatMap((p) => {
      const question = questionFor({ title: p.title, h1: p.h1, headings: p.headings ? (JSON.parse(p.headings) as string[]) : [] }, tracked);
      return question ? [{ url: p.url, question, chars: p.wordCount * 6 }] : [];
    });
}
