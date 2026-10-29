import { mentions, sentences } from "@/lib/truth";

// Rule-based tone of what AI answers say about a brand: words in sentences that name it, with simple negation
// ("not reliable" counts as negative). A heuristic labelled as such; it reads stored answers and costs nothing.

const POSITIVE = ["best", "excellent", "great", "recommended", "recommend", "reliable", "popular", "leading", "easy", "affordable", "trusted", "top", "strong", "fast", "secure", "intuitive", "praised", "favorite", "favourite", "standout", "good", "well-regarded", "highly rated", "love"];
const NEGATIVE = ["expensive", "poor", "complaints", "complaint", "slow", "avoid", "lacks", "lacking", "limited", "outdated", "scam", "unreliable", "issues", "problems", "worse", "worst", "drawback", "drawbacks", "downside", "difficult", "confusing", "buggy", "overpriced", "criticized", "criticised", "lawsuit", "breach", "bad", "hidden fees"];
const NEGATORS = new Set(["not", "no", "never", "isn't", "isnt", "aren't", "arent", "wasn't", "doesn't", "doesnt", "don't", "dont", "hardly", "without"]);

function score(sentence: string) {
  const words = sentence.toLowerCase().replace(/[^a-z0-9'\- ]/g, " ").split(/\s+/).filter(Boolean);
  let s = 0;
  const hit = (phrase: string, sign: number) => {
    const parts = phrase.split(" ");
    for (let i = 0; i + parts.length <= words.length; i++) {
      if (parts.every((p, k) => words[i + k] === p)) {
        const negated = words.slice(Math.max(0, i - 3), i).some((w) => NEGATORS.has(w));
        s += negated ? -sign : sign;
      }
    }
  };
  POSITIVE.forEach((w) => hit(w, 1));
  NEGATIVE.forEach((w) => hit(w, -1));
  return s;
}

export type Tone = "positive" | "neutral" | "negative";

// Sentiment of one answer toward the brand; null when the answer doesn't mention it.
export function answerTone(answer: string, brandTerms: string[]): { tone: Tone; evidence: string[] } | null {
  const about = sentences(answer).filter((s) => brandTerms.some((t) => mentions(s, t)));
  if (!about.length) return null;
  const total = about.reduce((sum, s) => sum + score(s), 0);
  const tone: Tone = total > 0 ? "positive" : total < 0 ? "negative" : "neutral";
  return { tone, evidence: about.filter((s) => (tone === "neutral" ? true : Math.sign(score(s)) === Math.sign(total))).slice(0, 2) };
}

export function toneSummary(answers: { answer: string | null; error: string | null }[], brandTerms: string[]) {
  const tones = answers.flatMap((a) => (a.error || !a.answer ? [] : [answerTone(a.answer, brandTerms)])).filter((t): t is NonNullable<typeof t> => t !== null);
  const count = (t: Tone) => tones.filter((x) => x.tone === t).length;
  return {
    mentions: tones.length,
    positive: count("positive"),
    neutral: count("neutral"),
    negative: count("negative"),
    negativeExamples: tones.filter((t) => t.tone === "negative").flatMap((t) => t.evidence).slice(0, 5),
    positiveExamples: tones.filter((t) => t.tone === "positive").flatMap((t) => t.evidence).slice(0, 3),
  };
}
