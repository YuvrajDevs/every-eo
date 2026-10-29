import { verifyWebhookHmac } from "@/lib/shopify";
import { handleShopifyWebhook } from "@/lib/shopify-install";

export async function POST(req: Request) {
  if (!process.env.SHOPIFY_API_SECRET) return new Response("Not configured", { status: 503 });
  const body = await req.text();
  if (!verifyWebhookHmac(body, req.headers.get("x-shopify-hmac-sha256"))) return new Response("Invalid signature", { status: 401 });
  await handleShopifyWebhook(req.headers.get("x-shopify-topic") ?? "", req.headers.get("x-shopify-shop-domain"));
  return new Response(null, { status: 200 });
}
