import { test } from "node:test";
import assert from "node:assert/strict";
import { associate, beforeAfter, describe, parseDailyCsv, permutationP, spearman, weekStart, weeklyClicks, weeklyMentionRate } from "@/lib/attribution";

test("week boundaries are Mondays (UTC), including Sundays and year ends", () => {
  assert.equal(weekStart(new Date("2026-10-29T15:00:00Z")), "2026-10-26"); // Thursday
  assert.equal(weekStart(new Date("2026-11-01T23:59:00Z")), "2026-10-26"); // Sunday
  assert.equal(weekStart(new Date("2026-10-26T00:00:00Z")), "2026-10-26"); // Monday
  assert.equal(weekStart(new Date("2027-01-01T00:00:00Z")), "2026-12-28");
});

test("daily CSV: Search Console ISO dates and Bing M/D/YYYY dates", () => {
  const gsc = parseDailyCsv("Date,Clicks,Impressions,CTR,Position\n2026-10-01,10,\"1,000\",1%,4\n2026-10-02,5,500,1%,4\nbad,1,1,,\n");
  assert.equal(gsc.days.length, 2);
  assert.equal(gsc.days[0].impressions, 1000);
  const bing = parseDailyCsv("Date,Clicks,Impressions\n10/3/2026,7,70");
  assert.equal(bing.days[0].date.toISOString(), "2026-10-03T00:00:00.000Z");
  assert.match(parseDailyCsv("Query,Clicks\nx,1").error!, /Dates\.csv/);
});

test("weekly clicks keep only complete weeks", () => {
  const days = Array.from({ length: 10 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 5 + i)), clicks: 1, impressions: 1 })); // Mon 5 Oct .. Wed 14 Oct
  assert.deepEqual([...weeklyClicks(days)], [["2026-10-05", 7]]);
});

test("weekly mention rate pools runs in the same week and skips empty runs", () => {
  const m = weeklyMentionRate([
    { createdAt: new Date("2026-10-05"), mentioned: 2, total: 10 },
    { createdAt: new Date("2026-10-07"), mentioned: 6, total: 10 },
    { createdAt: new Date("2026-10-12"), mentioned: 0, total: 0 },
  ]);
  assert.deepEqual([...m], [["2026-10-05", 0.4]]);
});

test("spearman handles ties, perfect and inverse ranks; permutation test is deterministic", () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.ok(Math.abs(spearman([1, 1, 2, 3], [1, 2, 3, 4]) - 0.9487) < 1e-3);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), 0);
  const a = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.equal(permutationP(a, a), permutationP(a, a));
  assert.ok(permutationP(a, a) < 0.01);
  assert.ok(permutationP(a, [3, 8, 1, 6, 2, 7, 5, 4]) > 0.05);
});

const weeks = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 5 + 7 * i)).toISOString().slice(0, 10));

test("association needs 6 overlapping weeks and supports a lag", () => {
  const w = weeks(10);
  const vis = new Map(w.map((x, i) => [x, i / 10]));
  const clicks = new Map(w.map((x, i) => [x, 100 + i * 10]));
  const same = associate(vis, clicks, 0)!;
  assert.equal(same.weeks, 10);
  assert.equal(same.rho, 1);
  assert.ok(same.p < 0.01);
  assert.match(describe(same), /p < 0\.001/);
  assert.match(describe(same), /rose and fell with AI mentions the same week \(strong.*is unlikely to be chance.*doesn't show/);
  const lagged = associate(vis, clicks, 2)!;
  assert.equal(lagged.weeks, 8);
  assert.equal(associate(new Map(w.slice(0, 5).map((x) => [x, 0.5])), clicks, 0), null);
});

test("noise reads as 'could easily be chance'", () => {
  const w = weeks(8);
  const a = associate(new Map(w.map((x, i) => [x, [0.2, 0.5, 0.1, 0.4, 0.3, 0.6, 0.2, 0.5][i]])), new Map(w.map((x, i) => [x, [50, 52, 47, 55, 49, 51, 53, 48][i]])), 0)!;
  assert.match(describe(a), /could easily be chance/, describe(a));
});

test("before/after compares complete weeks either side of the pivot week", () => {
  const w = weeks(10);
  const clicks = new Map(w.map((x, i) => [x, i < 5 ? 100 : 150]));
  const r = beforeAfter(clicks, new Date(`${w[4]}T12:00:00Z`), 4)!;
  assert.equal(r.before, 100);
  assert.equal(r.after, 150);
  assert.equal(r.change, 0.5);
  assert.equal(beforeAfter(clicks, new Date(`${w[1]}T00:00:00Z`), 4), null, "not enough weeks before");
});
