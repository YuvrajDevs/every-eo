import { test } from "node:test";
import assert from "node:assert/strict";
import { entitiesFor, leadersByPrompt, shareOfVoice, trend } from "@/lib/share-of-voice";
import { answerTone, toneSummary } from "@/lib/sentiment";

const ents = entitiesFor("Acme Mail", ["acmemail", "acme"], ["Rival Mail", "PostPal"]);
const a = (answer: string | null, promptId = "p1", runId = "r1", error: string | null = null, createdAt = new Date("2026-10-01")) => ({ promptId, engine: "chatgpt", answer, error, runId, createdAt });

test("share of voice: mention rates with ranges, share of all mentions, errors excluded, you listed first on ties", () => {
  const rows = shareOfVoice([a("Acme Mail and Rival Mail are both good."), a("Rival Mail is cheapest."), a("PostPal works."), a("Nothing relevant."), a(null, "p1", "r1", "429")], ents);
  assert.deepEqual(rows.map((r) => [r.name, r.mentions]), [["Rival Mail", 2], ["Acme Mail", 1], ["PostPal", 1]]);
  const you = rows.find((r) => r.isYou)!;
  assert.equal(you.answers, 4);
  assert.equal(you.mentionRate, 0.25);
  assert.equal(you.share, 0.25);
  assert.ok(you.low < 0.25 && you.high > 0.25);
  assert.deepEqual(shareOfVoice([], ents).map((r) => r.share), [0, 0, 0]);
});

test("leaders per question and trend per run", () => {
  const ans = [a("Rival Mail wins.", "p1"), a("Rival Mail again.", "p1"), a("Acme Mail is the pick.", "p2"), a("None.", "p3")];
  const l = leadersByPrompt(ans, ents);
  assert.deepEqual(l.map((x) => [x.promptId, x.leader]), [["p1", "Rival Mail"], ["p2", "Acme Mail"], ["p3", null]]);
  const t = trend([a("Acme.", "p1", "old", null, new Date("2026-09-01")), a("x", "p1", "old", null, new Date("2026-09-01")), a("Acme Mail!", "p1", "new", null, new Date("2026-10-01"))], ents);
  assert.deepEqual(t.map((x) => x.rates["Acme Mail"]), [0.5, 1]);
});

test("tone: positive, negative, negation flips, neutral, and answers that don't mention you", () => {
  const terms = ["acmemail", "acme"];
  assert.equal(answerTone("Acme Mail is reliable and easy to use.", terms)?.tone, "positive");
  assert.equal(answerTone("Acme Mail is expensive and has had complaints.", terms)?.tone, "negative");
  assert.equal(answerTone("Acme Mail is not reliable.", terms)?.tone, "negative");
  assert.equal(answerTone("Acme Mail isn't expensive.", terms)?.tone, "positive");
  assert.equal(answerTone("Acme Mail offers mail scanning.", terms)?.tone, "neutral");
  assert.equal(answerTone("Rival Mail is the best.", terms), null);
  assert.equal(answerTone("Rival Mail is the best. Acme Mail has hidden fees.", terms)?.tone, "negative", "only sentences about you count");
  const sum = toneSummary([{ answer: "Acme is great.", error: null }, { answer: "Acme is overpriced.", error: null }, { answer: "Other.", error: null }, { answer: null, error: "x" }], terms);
  assert.deepEqual([sum.mentions, sum.positive, sum.negative, sum.neutral], [2, 1, 1, 0]);
  assert.deepEqual(sum.negativeExamples, ["Acme is overpriced."]);
});
