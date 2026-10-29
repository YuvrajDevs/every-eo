import { handleStripeEvent, verifyWebhook } from "@/lib/stripe";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Billing webhooks are not configured", { status: 503 });
  const payload = await req.text();
  if (!verifyWebhook(payload, req.headers.get("stripe-signature"), secret)) return new Response("Invalid signature", { status: 400 });
  const result = await handleStripeEvent(JSON.parse(payload));
  return Response.json({ received: true, result });
}
