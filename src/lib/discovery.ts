import { columnIndex, parseCsv, toNumber } from "@/lib/csv";

// Suggests questions to track from what the site already says (question-style headings), from real searches
// (an imported Search Console export), and from simple category templates. All free: no AI calls.

export type Suggestion = { text: string; source: "search" | "site" | "template"; why: string; aboutYou?: boolean };

const QUESTION = /^(how|what|why|when|where|which|who|can|is|are|do|does|should|will|best|top|cheapest)\b/i;
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export type GscRow = { query: string; clicks: number; impressions: number; ctr: number | null; position: number | null };

// Search Console → Performance → Export → CSV (the "Queries" file). Header names differ by export language/version.
export function parseGscQueries(csv: string): { rows: GscRow[]; error?: string } {
  const table = parseCsv(csv);
  if (table.length < 2) return { rows: [], error: "That file has no rows." };
  const h = table[0];
  const q = columnIndex(h, "Top queries", "Query", "Queries", "Top query");
  const c = columnIndex(h, "Clicks");
  const im = columnIndex(h, "Impressions");
  if (q < 0 || c < 0 || im < 0) return { rows: [], error: "Expected the Search Console 'Queries' export (columns: Top queries, Clicks, Impressions)." };
  const ctr = columnIndex(h, "CTR");
  const pos = columnIndex(h, "Position");
  const rows = table.slice(1).flatMap((r) => {
    const query = (r[q] ?? "").trim();
    const clicks = toNumber(r[c]);
    const impressions = toNumber(r[im]);
    if (!query || clicks === null || impressions === null) return [];
    return [{ query: query.slice(0, 300), clicks, impressions, ctr: ctr >= 0 ? toNumber(r[ctr]) : null, position: pos >= 0 ? toNumber(r[pos]) : null }];
  });
  return { rows: rows.slice(0, 5000) };
}

export function suggestPrompts(input: {
  headings: string[];
  gsc: GscRow[];
  category: string | null;
  competitors: string[];
  brandTerms: string[];
  brandName: string;
  existing: string[];
  limit?: number;
}): Suggestion[] {
  const isBranded = (s: string) => input.brandTerms.some((t) => t.length >= 3 && squash(s).includes(t));
  const seen = new Set(input.existing.map(key));
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => {
    const k = key(s.text);
    if (!k || seen.has(k) || s.text.length < 8 || s.text.length > 300) return;
    seen.add(k);
    out.push(s);
  };

  // Real searches people already make, highest impressions first. Long or question-shaped queries resemble AI prompts.
  [...input.gsc]
    .filter((r) => !isBranded(r.query) && (QUESTION.test(r.query) || r.query.split(/\s+/).length >= 4))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15)
    .forEach((r) => add({ text: r.query, source: "search", why: `${r.impressions.toLocaleString()} Google impressions${r.position ? `, average position ${r.position.toFixed(1)}` : ""}` }));

  // Questions the site already answers.
  input.headings
    .map((h) => h.replace(/\s+/g, " ").trim())
    .filter((h) => (h.endsWith("?") || QUESTION.test(h)) && !isBranded(h) && h.split(" ").length >= 3)
    .slice(0, 15)
    .forEach((h) => add({ text: h.endsWith("?") ? h : `${h}?`, source: "site", why: "A question your site answers" }));

  const cat = input.category?.trim();
  if (cat) {
    for (const t of [`What is the best ${cat}?`, `Which ${cat} is best for small businesses?`, `What is the cheapest ${cat}?`, `How do I choose a ${cat}?`]) {
      add({ text: t, source: "template", why: "Common way people ask AI for recommendations" });
    }
    for (const c of input.competitors.slice(0, 3)) add({ text: `What are the best alternatives to ${c}?`, source: "template", why: `Customers comparing you with ${c}` });
  }
  // Questions about the brand itself: useful for the accuracy monitor, kept separate because they contain the name.
  if (input.brandName) {
    for (const t of [`What does ${input.brandName} cost?`, `Is ${input.brandName} any good?`]) add({ text: t, source: "template", why: "Checks what AI says about you", aboutYou: true });
  }
  return out.slice(0, input.limit ?? 30);
}
