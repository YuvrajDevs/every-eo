import type { CheerioAPI } from "cheerio";

// Heuristic "answer readiness": how easy a page is for an AI engine to quote.
// Based on the GEO paper's finding (statistics, sources, clear structure help) plus common
// answer-engine guidance. It is a beta heuristic, not a measured ranking factor.
export type AnswerSignals = {
  earlyAnswer: boolean;
  questionHeadings: number;
  sectionHeadings: number;
  hasList: boolean;
  hasTable: boolean;
  statCount: number;
  hasFaq: boolean;
};

const QUESTION_START = /^(how|what|why|when|where|which|who|can|is|are|do|does|should|will)\b/i;

export function answerSignals($: CheerioAPI, jsonLdTypes: string[]): AnswerSignals {
  const headings = $("h2, h3")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const paragraphs = $("main p, article p, body p")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((t) => t.length > 0)
    .slice(0, 4);
  const text = $("body").text().replace(/\s+/g, " ");

  return {
    earlyAnswer: paragraphs.some((p) => {
      const words = p.split(" ").length;
      return words >= 15 && words <= 90;
    }),
    questionHeadings: headings.filter((h) => h.endsWith("?") || QUESTION_START.test(h)).length,
    sectionHeadings: $("h2").length,
    hasList: $("ul, ol").toArray().some((el) => $(el).children("li").length >= 3),
    hasTable: $("table").length > 0,
    statCount: Math.min(20, (text.match(/\b\d+(\.\d+)?\s?%|\b\d{1,3}(,\d{3})+\b|\b(19|20)\d{2}\b/g) ?? []).length),
    hasFaq: jsonLdTypes.includes("FAQPage") || headings.some((h) => /faq|frequently asked/i.test(h)),
  };
}

export function answerScore(s: AnswerSignals) {
  let score = 0;
  if (s.earlyAnswer) score += 30;
  score += s.questionHeadings >= 2 ? 20 : s.questionHeadings === 1 ? 10 : 0;
  if (s.hasList || s.hasTable) score += 15;
  score += s.statCount >= 3 ? 15 : s.statCount > 0 ? 8 : 0;
  if (s.sectionHeadings >= 3) score += 10;
  if (s.hasFaq) score += 10;
  return score;
}
