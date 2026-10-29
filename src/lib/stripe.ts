import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { planForPrice, PLANS, type Plan, priceFor } from "@/lib/plans";

// Minimal Stripe client over fetch (Checkout, Billing Portal, webhooks). Disabled until STRIPE_SECRET_KEY is set.

const API = "https://api.stripe.com/v1";

export const billingEnabled = () => Boolean(process.env.STRIPE_SECRET_KEY);

function form(params: Record<string, string | undefined>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, v);
  return body;
}

async function stripe<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: form(params),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Stripe returned HTTP ${res.status}`);
  return json;
}

async function stripeGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }, signal: AbortSignal.timeout(20_000) });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Stripe returned HTTP ${res.status}`);
  return json;
}

// Agency plans are billed per client workspace: keep the subscription quantity equal to the client count (min 1).
export async function syncAgencySeats(org: { stripeSubscriptionId: string | null }, clients: number) {
  if (!billingEnabled() || !org.stripeSubscriptionId) return null;
  const sub = await stripeGet<{ items: { data: { id: string; quantity: number }[] } }>(`/subscriptions/${encodeURIComponent(org.stripeSubscriptionId)}`);
  const item = sub.items.data[0];
  const quantity = Math.max(1, clients);
  if (!item || item.quantity === quantity) return item?.quantity ?? null;
  await stripe(`/subscription_items/${encodeURIComponent(item.id)}`, { quantity: String(quantity), proration_behavior: "create_prorations" });
  return quantity;
}

export async function createCheckout(org: { id: string; stripeCustomerId: string | null }, plan: Plan, email: string, baseUrl: string, quantity = 1) {
  const price = priceFor(plan);
  if (!price) throw new Error(`No Stripe price is configured for ${plan.name} (set ${plan.priceEnv}).`);
  const session = await stripe<{ url: string }>("/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": String(Math.max(1, quantity)),
    client_reference_id: org.id,
    "metadata[orgId]": org.id,
    "subscription_data[metadata][orgId]": org.id,
    ...(org.stripeCustomerId ? { customer: org.stripeCustomerId } : { customer_email: email }),
    success_url: `${baseUrl}/dashboard/billing?checkout=success`,
    cancel_url: `${baseUrl}/dashboard/billing`,
  });
  return session.url;
}

export async function createPortal(customerId: string, baseUrl: string) {
  const session = await stripe<{ url: string }>("/billing_portal/sessions", { customer: customerId, return_url: `${baseUrl}/dashboard/billing` });
  return session.url;
}

// Stripe-Signature: t=<unix>,v1=<hex hmac of "t.payload">; reject anything older than the tolerance (replay protection).
export function verifyWebhook(payload: string, header: string | null, secret: string, now = Date.now(), toleranceSec = 300) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  const sigs = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (!t || sigs.length === 0 || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest();
  return sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };
type Subscription = { id: string; customer: string; status: string; current_period_end?: number; metadata?: { orgId?: string }; items?: { data: { price: { id: string } }[] } };

const PAID = new Set(["active", "trialing", "past_due"]);

async function applySubscription(sub: Subscription) {
  const org =
    (sub.metadata?.orgId && (await db.organization.findUnique({ where: { id: sub.metadata.orgId } }))) ||
    (await db.organization.findFirst({ where: { OR: [{ stripeSubscriptionId: sub.id }, { stripeCustomerId: sub.customer }] } }));
  if (!org) return;
  const plan = sub.items?.data[0] ? planForPrice(sub.items.data[0].price.id) : null;
  await db.organization.update({
    where: { id: org.id },
    data: {
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: sub.id,
      planStatus: sub.status,
      currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      // Lapsed or unknown-price subscriptions fall back to the trial limits rather than keeping paid access.
      plan: PAID.has(sub.status) && plan ? plan.id : PLANS.trial.id,
    },
  });
}

export async function handleStripeEvent(event: StripeEvent) {
  const seen = await db.stripeEvent.findUnique({ where: { id: event.id } });
  if (seen) return "duplicate";
  const obj = event.data.object;
  if (event.type === "checkout.session.completed") {
    const orgId = (obj.client_reference_id as string) || (obj.metadata as { orgId?: string } | undefined)?.orgId;
    if (orgId && (await db.organization.findUnique({ where: { id: orgId } }))) {
      await db.organization.update({ where: { id: orgId }, data: { stripeCustomerId: obj.customer as string, stripeSubscriptionId: (obj.subscription as string) ?? null } });
    }
  } else if (event.type.startsWith("customer.subscription.")) {
    await applySubscription(event.type === "customer.subscription.deleted" ? { ...(obj as unknown as Subscription), status: "canceled" } : (obj as unknown as Subscription));
  }
  await db.stripeEvent.create({ data: { id: event.id, type: event.type } });
  return "processed";
}
