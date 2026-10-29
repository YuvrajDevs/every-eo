import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { checkAnswer, factsSchema, numbers, prices, sentences } from "@/lib/truth";
import { parseFactsForm, factsToForm } from "@/lib/truth-form";

const facts = factsSchema.parse({
  prices: [{ label: "Starter", amount: 29, currency: "USD" }, { label: "Pro", amount: 79, currency: "USD" }],
  foundedYear: 2019,
  discontinued: ["Basic plan"],
  competitors: ["Rival Mail"],
  claims: ["We scan over 2 million letters a year for 40% less than a PO box"],
});
const terms = ["acmemail", "acme"];
const kinds = (answer: string, hosts: string[] = []) => checkAnswer(answer, terms, facts, hosts, "acmemail.com").map((i) => i.kind);

test("parsers: sentences, prices and normalised numbers", () => {
  assert.deepEqual(sentences("**Acme** is good [1]. Also cheap!\n- Rival too"), ["Acme is good .", "Also cheap!", "- Rival too"]);
  assert.deepEqual(prices("Costs $1,299.50 or 20 EUR, £5"), [{ amount: 1299.5, currency: "USD" }, { amount: 20, currency: "EUR" }, { amount: 5, currency: "GBP" }]);
  assert.deepEqual(numbers("2 million and 2,000,000 and 2M"), ["2000000", "2000000", "2000000"]);
  assert.deepEqual(numbers("37% vs 37 percent"), ["37%", "37%"]);
});

test("wrong price about the brand is flagged; correct prices and other brands' prices are not", () => {
  assert.deepEqual(kinds("Acme Mail costs $39 per month."), ["price_mismatch"]);
  assert.deepEqual(kinds("Acme Mail starts at $29/month, and Pro is $79."), []);
  assert.deepEqual(kinds("Rival Mail costs $39 per month."), [], "price about a competitor isn't ours to check");
  assert.deepEqual(kinds("Acme Mail costs €35 per month."), [], "no EUR prices on file → can't judge");
});

test("founding year and discontinued products", () => {
  assert.deepEqual(kinds("AcmeMail was founded in 2015 in Austin."), ["wrong_founding_year"]);
  assert.deepEqual(kinds("AcmeMail was founded in 2019."), []);
  assert.deepEqual(kinds("Their Basic plan is a good fit for individuals."), ["discontinued_as_current"]);
  assert.deepEqual(kinds("The Basic plan was discontinued in 2024."), []);
});

test("stolen claim: flagged when credited to a competitor or unnamed with other sources; fine when it's ours", () => {
  const stolen = "Rival Mail scans over 2 million letters a year for 40% less than a PO box.";
  const r = checkAnswer(stolen, terms, facts, [], "acmemail.com");
  assert.equal(r[0].kind, "stolen_claim");
  assert.equal(r[0].credited, "Rival Mail");
  const unnamed = checkAnswer("One service scans 2,000,000 letters a year, about 40 percent less than a PO box.", terms, facts, ["rivalmail.com", "acmemail.com"], "acmemail.com");
  assert.equal(unnamed[0]?.credited, "rivalmail.com");
  assert.deepEqual(kinds("Acme Mail scans over 2 million letters a year for 40% less than a PO box."), []);
  assert.deepEqual(kinds("Acme Mail is popular. It scans over 2 million letters a year for 40% less than a PO box."), [], "previous sentence names us");
  assert.deepEqual(kinds("Acme Mail costs $29. Rival Mail scans over 2 million letters a year for 40% less than a PO box."), ["stolen_claim"], "a rival named in the sentence itself overrides the previous sentence");
  assert.deepEqual(kinds("Rival Mail scans 3 million letters a year for 40% less than a PO box."), [], "different number → not our claim");
  assert.deepEqual(kinds("One service scans 2 million letters a year for 40% less than a PO box."), [], "no other source cited → can't say who got credit");
});

test("facts form: prices lines, defaults, errors, round trip", () => {
  const f = new FormData();
  f.set("prices", "Starter | 29 | usd\nPro|$79");
  f.set("foundedYear", "2019");
  f.set("claims", "We scan over 2 million letters a year");
  const ok = parseFactsForm(f);
  assert.ok(ok.success);
  assert.deepEqual(ok.data!.prices, [{ label: "Starter", amount: 29, currency: "USD" }, { label: "Pro", amount: 79, currency: "USD" }]);
  const back = factsToForm(ok.data!);
  assert.equal(back.prices, "Starter | 29 | USD\nPro | 79 | USD");
  f.set("prices", "just text");
  assert.match((parseFactsForm(f) as { error: string }).error, /Plan name \| 29 \| USD/);
  f.set("prices", "");
  f.set("foundedYear", "19");
  assert.equal(parseFactsForm(f).success, false);
});

process.env.DATABASE_URL = "file:./truth-test.db";
before(() => {
  fs.rmSync("truth-test.db", { force: true });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
});
after(async () => {
  await (await import("@/lib/db")).db.$disconnect();
  fs.rmSync("truth-test.db", { force: true });
});

test("truthCheck scans stored answers, replaces old findings, and raises one alert per kind", async () => {
  const { db } = await import("@/lib/db");
  const { truthCheck } = await import("@/worker/truth");
  const org = await db.organization.create({ data: { name: "o" } });
  const domain = await db.domain.create({ data: { orgId: org.id, hostname: "acmemail.com", brandName: "Acme Mail" } });
  const prompt = await db.prompt.create({ data: { domainId: domain.id, text: "best mail scanning?" } });
  const run = await db.visibilityRun.create({ data: { orgId: org.id, domainId: domain.id, engines: "chatgpt", status: "completed" } });
  await db.visibilityResult.createMany({
    data: [
      { runId: run.id, promptId: prompt.id, engine: "chatgpt", trial: 1, answer: "Acme Mail costs $39 a month.", citedUrls: "[]" },
      { runId: run.id, promptId: prompt.id, engine: "chatgpt", trial: 2, answer: "Acme Mail costs $49 a month.", citedUrls: "[]" },
      { runId: run.id, promptId: prompt.id, engine: "chatgpt", trial: 3, answer: "Rival Mail scans over 2 million letters a year for 40% less than a PO box.", citedUrls: JSON.stringify([{ url: "https://rivalmail.com/x" }]) },
      { runId: run.id, promptId: prompt.id, engine: "chatgpt", trial: 4, error: "429" },
    ],
  });
  assert.equal(await truthCheck(run.id), 0, "no facts saved → nothing to check");
  await db.factsRecord.create({ data: { domainId: domain.id, data: JSON.stringify(facts) } });
  assert.equal(await truthCheck(run.id), 3);
  assert.equal(await truthCheck(run.id, { alert: false }), 3);
  assert.equal(await db.truthIssue.count({ where: { runId: run.id } }), 3, "re-check replaces rather than duplicates");
  const alerts = await db.alert.findMany({ where: { domainId: domain.id }, orderBy: { kind: "asc" } });
  assert.deepEqual(alerts.map((a) => a.kind), ["misinformation", "stolen_claim"]);
  assert.match(alerts[0].title, /states a wrong price \(2 answers\)/);
});
