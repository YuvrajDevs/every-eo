import { wilson } from "@/lib/stats";
import { mentions } from "@/lib/truth";

// Who AI answers mention for your tracked questions: you and each named competitor. "Share of voice" is an
// entity's share of all mentions; "mention rate" is the share of answers that name it (with a 95% range).

export type Answer = { promptId: string; engine: string; answer: string | null; error: string | null; runId: string; createdAt: Date };
type Entity = { name: string; terms: string[]; isYou: boolean };

export function entitiesFor(brandName: string, brandTerms: string[], competitors: string[]): Entity[] {
  return [{ name: brandName, terms: brandTerms, isYou: true }, ...competitors.map((c) => ({ name: c, terms: [c], isYou: false }))];
}

const mentioned = (text: string, e: Entity) => e.terms.some((t) => mentions(text, t));

export function shareOfVoice(answers: Answer[], entities: Entity[]) {
  const ok = answers.filter((a) => !a.error && a.answer);
  const counts = entities.map((e) => ({ entity: e, hits: ok.filter((a) => mentioned(a.answer!, e)).length }));
  const totalMentions = counts.reduce((s, c) => s + c.hits, 0);
  return counts
    .map(({ entity, hits }) => {
      const ci = wilson(hits, ok.length);
      return { name: entity.name, isYou: entity.isYou, answers: ok.length, mentions: hits, mentionRate: ci.rate, low: ci.low, high: ci.high, share: totalMentions ? hits / totalMentions : 0 };
    })
    .sort((a, b) => b.mentions - a.mentions || Number(b.isYou) - Number(a.isYou));
}

// Per question: which entity is named most often. Highlights where a competitor owns the answer.
export function leadersByPrompt(answers: Answer[], entities: Entity[]) {
  const byPrompt = new Map<string, Answer[]>();
  for (const a of answers) if (!a.error && a.answer) byPrompt.set(a.promptId, [...(byPrompt.get(a.promptId) ?? []), a]);
  return [...byPrompt].map(([promptId, list]) => {
    const rates = entities.map((e) => ({ name: e.name, isYou: e.isYou, rate: list.filter((a) => mentioned(a.answer!, e)).length / list.length }));
    const top = [...rates].sort((a, b) => b.rate - a.rate)[0];
    return { promptId, answers: list.length, rates, leader: top && top.rate > 0 ? top.name : null };
  });
}

// Mention rate per entity per run, oldest first, for the trend table.
export function trend(answers: Answer[], entities: Entity[]) {
  const runs = new Map<string, { at: Date; list: Answer[] }>();
  for (const a of answers) {
    if (a.error || !a.answer) continue;
    const r = runs.get(a.runId) ?? { at: a.createdAt, list: [] };
    r.list.push(a);
    runs.set(a.runId, r);
  }
  return [...runs.values()]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((r) => ({ at: r.at, answers: r.list.length, rates: Object.fromEntries(entities.map((e) => [e.name, r.list.filter((a) => mentioned(a.answer!, e)).length / r.list.length])) }));
}
