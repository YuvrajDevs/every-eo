import { z } from "zod";

// Checks stored AI answers against facts the owner gives us. Deterministic text matching on purpose: it only flags
// what it can point to (a sentence and the fact it contradicts), and it never needs another paid AI call.

const money = z.object({ label: z.string().trim().min(1).max(80), amount: z.number().nonnegative(), currency: z.string().trim().max(3).default("USD") });

export const factsSchema = z.object({
  prices: z.array(money).max(30).default([]),
  foundedYear: z.number().int().min(1800).max(2100).optional(),
  discontinued: z.array(z.string().trim().min(2).max(80)).max(30).default([]),
  competitors: z.array(z.string().trim().min(2).max(80)).max(30).default([]),
  claims: z.array(z.string().trim().min(10).max(300)).max(30).default([]),
});
export type BrandFacts = z.infer<typeof factsSchema>;

export type Issue = {
  kind: "price_mismatch" | "discontinued_as_current" | "wrong_founding_year" | "stolen_claim";
  sentence: string;
  detail: string;
  credited?: string; // stolen_claim: who got the credit
};

const CURRENCY: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "₹": "INR", "¥": "JPY" };

export function sentences(text: string) {
  return text
    .replace(/\[(\d+)\]/g, "") // citation markers like [1]
    .replace(/[*_`#>]+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 3);
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export const mentions = (sentence: string, term: string) => {
  const t = squash(term);
  return t.length >= 3 && squash(sentence).includes(t);
};

export function prices(sentence: string) {
  const out: { amount: number; currency: string }[] = [];
  const re = /([$€£₹¥])\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s?(USD|EUR|GBP|INR|dollars?|euros?)\b/gi;
  for (const m of sentence.matchAll(re)) {
    if (m[1]) out.push({ amount: Number(m[2].replace(/,/g, "")), currency: CURRENCY[m[1]] });
    else {
      const c = m[4].toUpperCase();
      out.push({ amount: Number(m[3]), currency: c.startsWith("DOLLAR") ? "USD" : c.startsWith("EURO") ? "EUR" : c });
    }
  }
  return out;
}

// Numbers as values: "2 million" = "2,000,000" = "2M"; "37%" = "37 percent".
export function numbers(text: string) {
  const out: string[] = [];
  const re = /(\d+(?:[.,]\d+)*)\s?(%|percent|million|billion|thousand|[mbk]\b)?/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[1];
    const base = /^\d{1,3}(,\d{3})+$/.test(raw) ? Number(raw.replace(/,/g, "")) : Number(raw.replace(",", "."));
    if (!Number.isFinite(base)) continue;
    const unit = (m[2] ?? "").toLowerCase();
    if (unit === "%" || unit === "percent") out.push(`${base}%`);
    else {
      const mult = unit === "million" || unit === "m" ? 1e6 : unit === "billion" || unit === "b" ? 1e9 : unit === "thousand" || unit === "k" ? 1e3 : 1;
      out.push(String(Math.round(base * mult)));
    }
  }
  return out;
}

const STOP = new Set("the a an and or of to in for on with by is are was were be our we us your you it its that this as at from than more most per each over".split(" "));
const words = (s: string) => s.toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !STOP.has(w)) ?? [];

const NEGATED = /\b(discontinued|no longer|retired|deprecated|sunset|was replaced|replaced by|shut down|end[- ]of[- ]life|used to)\b/i;
const FOUNDED = /\b(founded|established|launched|started|created|began)\b[^.]*?\b(1[89]\d{2}|20\d{2})\b/i;

export function checkAnswer(answer: string, brandTerms: string[], facts: BrandFacts, citedHosts: string[] = [], brandHost = ""): Issue[] {
  const issues: Issue[] = [];
  const ss = sentences(answer);
  const aboutBrand = (i: number) => brandTerms.some((t) => mentions(ss[i], t));

  ss.forEach((s, i) => {
    if (!aboutBrand(i)) return;
    // Price: every amount in a sentence about the brand must match a listed price in that currency.
    if (facts.prices.length) {
      for (const p of prices(s)) {
        const known = facts.prices.filter((k) => k.currency === p.currency);
        if (known.length && !known.some((k) => Math.abs(k.amount - p.amount) < 0.5)) {
          issues.push({ kind: "price_mismatch", sentence: s, detail: `Says ${p.currency} ${p.amount}; your prices are ${known.map((k) => `${k.label} ${k.currency} ${k.amount}`).join(", ")}.` });
        }
      }
    }
    const f = s.match(FOUNDED);
    if (facts.foundedYear && f && Number(f[2]) !== facts.foundedYear) {
      issues.push({ kind: "wrong_founding_year", sentence: s, detail: `Says ${f[2]}; you were founded in ${facts.foundedYear}.` });
    }
  });

  // Discontinued products described as if available (the sentence itself needn't name the brand).
  ss.forEach((s) => {
    for (const d of facts.discontinued) {
      if (mentions(s, d) && !NEGATED.test(s)) issues.push({ kind: "discontinued_as_current", sentence: s, detail: `Mentions "${d}" without saying it's discontinued.` });
    }
  });

  // Stolen claims: a sentence carrying your distinctive numbers and most of your wording, credited to someone else.
  for (const claim of facts.claims) {
    const nums = numbers(claim);
    const keyWords = [...new Set(words(claim))];
    if (nums.length === 0 && keyWords.length < 4) continue;
    ss.forEach((s, i) => {
      const sNums = numbers(s);
      if (nums.length && !nums.every((n) => sNums.includes(n))) return;
      const overlap = keyWords.filter((w) => s.toLowerCase().includes(w)).length / Math.max(1, keyWords.length);
      if (overlap < 0.5) return;
      const nearBrand = aboutBrand(i) || (i > 0 && aboutBrand(i - 1));
      if (nearBrand) return;
      const rival = facts.competitors.find((c) => mentions(s, c) || (i > 0 && mentions(ss[i - 1], c)));
      const others = citedHosts.filter((h) => brandHost && h !== brandHost && !h.endsWith(`.${brandHost}`));
      if (!rival && others.length === 0) return;
      issues.push({
        kind: "stolen_claim",
        sentence: s,
        credited: rival ?? others.slice(0, 3).join(", "),
        detail: rival ? `Your claim "${claim.slice(0, 80)}" is attributed to ${rival}.` : `Your claim "${claim.slice(0, 80)}" appears without your name, and the answer cites ${others.slice(0, 3).join(", ")}.`,
      });
    });
  }

  // One entry per kind + sentence.
  const seen = new Set<string>();
  return issues.filter((x) => (seen.has(`${x.kind}|${x.sentence}`) ? false : (seen.add(`${x.kind}|${x.sentence}`), true)));
}
