import { test } from "node:test";
import assert from "node:assert/strict";
import { journalistPitch, presence, reviewRequestEmail } from "@/lib/presence";

const answers = [
  { citedHosts: ["g2.com", "reddit.com", "techradar.com", "acme.com"] },
  { citedHosts: ["g2.com", "techradar.com", "vertexaisearch.cloud.google.com"] },
  { citedHosts: ["en.wikipedia.org", "zapier.com", "zapier.com"] },
  { citedHosts: [] },
];

test("channels cited by AI where you're missing rank first; listed ones say keep current", () => {
  const { rows, totalAnswers } = presence({ sameAs: ["https://www.reddit.com/user/acme", "not a url"], answers, brandHost: "acme.com" });
  assert.equal(totalAnswers, 4);
  assert.equal(rows[0].channel.id, "g2");
  assert.equal(rows[0].priority, "high");
  assert.equal(rows[0].citedAnswers, 2);
  assert.match(rows[0].reason, /Cited in 2 of 4 AI answers.*not listed/);
  const reddit = rows.find((r) => r.channel.id === "reddit")!;
  assert.equal(reddit.listed, true);
  assert.equal(reddit.priority, "medium");
  assert.match(reddit.reason, /keep your profile current/);
  assert.equal(rows.find((r) => r.channel.id === "wikipedia")!.priority, "high", "en.wikipedia.org matches");
  assert.equal(rows.find((r) => r.channel.id === "capterra")!.priority, "medium", "uncited review site still worth doing");
  assert.equal(rows.find((r) => r.channel.id === "producthunt")!.priority, "low");
});

test("publications exclude your site, known channels, search engines' redirect hosts; counted once per answer", () => {
  const { publications } = presence({ sameAs: [], answers, brandHost: "acme.com" });
  assert.deepEqual(publications, [
    { host: "techradar.com", answers: 2 },
    { host: "zapier.com", answers: 1 },
  ]);
});

test("no answers yet: nothing marked high, review sites still medium", () => {
  const { rows, publications } = presence({ sameAs: [], answers: [], brandHost: "acme.com" });
  assert.ok(rows.every((r) => r.priority !== "high"));
  assert.equal(publications.length, 0);
});

test("templates fill in the brand and leave placeholders for the person", () => {
  assert.match(reviewRequestEmail("Acme", "acme.com"), /review Acme[\s\S]*\{review link\}[\s\S]*good or bad/);
  assert.match(journalistPitch("Acme", ""), /\{topic\}/);
});
