import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";

process.env.DATABASE_URL = "file:./billing-test.db";
process.env.STRIPE_PRICE_STARTER = "price_starter";
process.env.STRIPE_PRICE_GROWTH = "price_growth";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

before(() => {
  fs.rmSync("billing-test.db", { force: true });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
});
after(async () => {
  await (await import("@/lib/db")).db.$disconnect();
  fs.rmSync("billing-test.db", { force: true });
});

const sign = (payload: string, t = Math.floor(Date.now() / 1000), secret = "whsec_test") => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

test("webhook signatures: valid, wrong secret, tampered, stale, missing, multiple v1", async () => {
  const { verifyWebhook } = await import("@/lib/stripe");
  const body = '{"id":"evt_1"}';
  assert.equal(verifyWebhook(body, sign(body), "whsec_test"), true);
  assert.equal(verifyWebhook(body, sign(body, undefined, "other"), "whsec_test"), false);
  assert.equal(verifyWebhook('{"id":"evt_2"}', sign(body), "whsec_test"), false);
  assert.equal(verifyWebhook(body, sign(body, Math.floor(Date.now() / 1000) - 3600), "whsec_test"), false);
  assert.equal(verifyWebhook(body, null, "whsec_test"), false);
  assert.equal(verifyWebhook(body, "t=abc,v1=zz", "whsec_test"), false);
  const t = Math.floor(Date.now() / 1000);
  assert.equal(verifyWebhook(body, `t=${t},v1=deadbeef,${sign(body, t).split(",")[1]}`, "whsec_test"), true, "any matching v1 (secret rotation)");
});

test("subscription lifecycle drives the org's plan; duplicates are ignored", async () => {
  const { db } = await import("@/lib/db");
  const { POST } = await import("@/app/api/stripe/webhook/route");
  const org = await db.organization.create({ data: { name: "Paying Co" } });
  const send = async (event: object) => {
    const body = JSON.stringify(event);
    const res = await POST(new Request("http://x/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": sign(body) } }));
    return { status: res.status, json: await res.json() };
  };
  const sub = (status: string, price: string) => ({ id: "sub_1", customer: "cus_1", status, current_period_end: 1893456000, metadata: { orgId: org.id }, items: { data: [{ price: { id: price } }] } });

  assert.equal((await send({ id: "evt_a", type: "checkout.session.completed", data: { object: { client_reference_id: org.id, customer: "cus_1", subscription: "sub_1" } } })).status, 200);
  assert.equal((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).stripeCustomerId, "cus_1");

  await send({ id: "evt_b", type: "customer.subscription.created", data: { object: sub("active", "price_growth") } });
  let o = await db.organization.findUniqueOrThrow({ where: { id: org.id } });
  assert.equal(o.plan, "growth");
  assert.equal(o.currentPeriodEnd!.toISOString(), "2030-01-01T00:00:00.000Z");

  const dup = await send({ id: "evt_b", type: "customer.subscription.created", data: { object: sub("active", "price_starter") } });
  assert.equal(dup.json.result, "duplicate");
  assert.equal((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).plan, "growth");

  await send({ id: "evt_c", type: "customer.subscription.updated", data: { object: sub("past_due", "price_starter") } });
  o = await db.organization.findUniqueOrThrow({ where: { id: org.id } });
  assert.equal(o.plan, "starter", "past_due keeps access while Stripe retries payment");
  assert.equal(o.planStatus, "past_due");

  await send({ id: "evt_d", type: "customer.subscription.updated", data: { object: sub("active", "price_unknown") } });
  assert.equal((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).plan, "trial", "unknown price never grants a paid plan");

  // Deleted event without metadata: found by subscription id.
  await send({ id: "evt_e", type: "customer.subscription.deleted", data: { object: { ...sub("active", "price_growth"), metadata: {} } } });
  o = await db.organization.findUniqueOrThrow({ where: { id: org.id } });
  assert.equal(o.plan, "trial");
  assert.equal(o.planStatus, "canceled");
});

test("webhook rejects bad signatures and works only when configured", async () => {
  const { POST } = await import("@/app/api/stripe/webhook/route");
  const body = JSON.stringify({ id: "evt_x", type: "customer.subscription.updated", data: { object: {} } });
  assert.equal((await POST(new Request("http://x", { method: "POST", body, headers: { "stripe-signature": "t=1,v1=00" } }))).status, 400);
  const saved = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  assert.equal((await POST(new Request("http://x", { method: "POST", body }))).status, 503);
  process.env.STRIPE_WEBHOOK_SECRET = saved;
});

test("checkout session request carries the org, price and return URLs", async () => {
  const { createCheckout } = await import("@/lib/stripe");
  const { PLANS } = await import("@/lib/plans");
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  const realFetch = globalThis.fetch;
  let sent: URLSearchParams | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal((init.headers as Record<string, string>).authorization, "Bearer sk_test_x");
    sent = init.body as URLSearchParams;
    return Response.json({ url: "https://checkout.stripe.com/c/abc" });
  }) as typeof fetch;
  try {
    const url = await createCheckout({ id: "org_1", stripeCustomerId: null }, PLANS.growth, "a@b.co", "https://app.test");
    assert.equal(url, "https://checkout.stripe.com/c/abc");
    const p = sent!;
    assert.equal(p.get("line_items[0][price]"), "price_growth");
    assert.equal(p.get("client_reference_id"), "org_1");
    assert.equal(p.get("customer_email"), "a@b.co");
    assert.equal(p.get("success_url"), "https://app.test/dashboard/billing?checkout=success");
    await assert.rejects(createCheckout({ id: "o", stripeCustomerId: null }, PLANS.advanced, "a@b.co", "x"), /STRIPE_PRICE_ADVANCED/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.STRIPE_SECRET_KEY;
  }
});

test("plan limits: pages per audit, repeats per question, and monthly AI answer quota", async () => {
  const { db } = await import("@/lib/db");
  const { startCrawl, startVisibility } = await import("@/lib/jobs");
  process.env.OPENAI_API_KEY = "k";
  try {
    const org = await db.organization.create({ data: { name: "Limits", plan: "starter" } });
    const domain = await db.domain.create({ data: { orgId: org.id, hostname: "limits.com" } });
    const crawlId = await startCrawl(org.id, domain.id);
    assert.equal((await db.crawl.findUniqueOrThrow({ where: { id: crawlId } })).maxPages, 200);

    await db.prompt.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ domainId: domain.id, text: `question ${i}?` })) });
    assert.deepEqual(await startVisibility(org.id, domain.id, 10), { error: "Your Starter plan allows up to 5 repeats per question." });

    // 4,000 answers a month on Starter: use 3,980 already, then a 10 × 1 × 5 = 50-answer run must be refused.
    const prompt = await db.prompt.findFirstOrThrow({ where: { domainId: domain.id } });
    const old = await db.visibilityRun.create({ data: { orgId: org.id, domainId: domain.id, engines: "chatgpt", status: "completed" } });
    await db.visibilityResult.createMany({ data: Array.from({ length: 3980 }, (_, i) => ({ runId: old.id, promptId: prompt.id, engine: "chatgpt", trial: i })) });
    const refused = await startVisibility(org.id, domain.id, 5);
    assert.ok("error" in refused && /needs 50 AI answers.*20 of 4000 left/.test(refused.error), JSON.stringify(refused));
    const ok = await startVisibility(org.id, domain.id, 2);
    assert.ok("runId" in ok, "a 20-answer run still fits");

    // Last month's answers don't count.
    await db.visibilityResult.updateMany({ where: { runId: old.id }, data: { createdAt: new Date("2020-01-01") } });
    const { usageThisMonth } = await import("@/lib/usage");
    assert.equal((await usageThisMonth(org.id)).answers, 0);
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test("a scheduled check over quota is skipped with an alert, not silently", async () => {
  const { db } = await import("@/lib/db");
  const { runDueSchedules } = await import("@/worker/scheduler");
  process.env.OPENAI_API_KEY = "k";
  try {
    const org = await db.organization.create({ data: { name: "Quota", plan: "trial" } });
    const domain = await db.domain.create({ data: { orgId: org.id, hostname: "quota.com", visibilitySchedule: "weekly", visibilityTrials: 10, nextVisibilityAt: new Date("2020-01-01") } });
    await db.prompt.createMany({ data: Array.from({ length: 15 }, (_, i) => ({ domainId: domain.id, text: `q${i}?` })) }); // 15 × 1 × 10 = 150 ≤ 300
    await runDueSchedules();
    assert.equal(await db.visibilityRun.count({ where: { domainId: domain.id } }), 1);
    await db.visibilityRun.updateMany({ where: { domainId: domain.id }, data: { status: "completed" } });
    const run = await db.visibilityRun.findFirstOrThrow({ where: { domainId: domain.id } });
    const p = await db.prompt.findFirstOrThrow({ where: { domainId: domain.id } });
    await db.visibilityResult.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ runId: run.id, promptId: p.id, engine: "chatgpt", trial: i })) });
    await db.domain.update({ where: { id: domain.id }, data: { nextVisibilityAt: new Date("2020-01-01") } });
    await runDueSchedules();
    assert.equal(await db.visibilityRun.count({ where: { domainId: domain.id } }), 1, "second run refused");
    const alert = await db.alert.findFirstOrThrow({ where: { domainId: domain.id, kind: "schedule_skipped" } });
    assert.match(alert.detail, /needs 150 AI answers/);
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});
