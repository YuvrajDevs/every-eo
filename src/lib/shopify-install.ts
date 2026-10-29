import { db } from "@/lib/db";
import { encrypt } from "@/lib/secrets";
import { appInstallationId, exchangeCode, normalizeShop, verifyQueryHmac } from "@/lib/shopify";

export const STATE_COOKIE = "shopify_oauth";

// Validates Shopify's OAuth callback against the state cookie we set at install time, then stores the token.
// Returns the domain id to send the user back to, or an error message.
export async function completeInstall(params: URLSearchParams, cookie: string | undefined, orgId: string): Promise<{ domainId: string } | { error: string }> {
  if (!verifyQueryHmac(params)) return { error: "The request didn't come from Shopify (bad signature)." };
  const shop = normalizeShop(params.get("shop") ?? "");
  // Cookie is "<state>.<domainId>.<shop>"; the shop itself contains dots, so split only the first two.
  const [state, domainId, ...shopParts] = (cookie ?? "").split(".");
  const cookieShop = shopParts.join(".");
  if (!shop || !state || state !== params.get("state") || cookieShop !== shop) return { error: "This install link expired or was opened in another browser. Start again from the Fixes page." };
  const domain = await db.domain.findFirst({ where: { id: domainId, orgId } });
  if (!domain) return { error: "That site isn't in your workspace." };
  const other = await db.shopifyConnection.findUnique({ where: { shop } });
  if (other && other.domainId !== domain.id) return { error: "This store is already connected to another site." };
  const code = params.get("code");
  if (!code) return { error: "Shopify didn't send an authorization code." };
  const { token, scopes } = await exchangeCode(shop, code);
  const installationId = await appInstallationId(shop, token);
  const data = { shop, token: encrypt(token), scopes, installationId };
  await db.shopifyConnection.upsert({ where: { domainId: domain.id }, update: data, create: { domainId: domain.id, ...data } });
  return { domainId: domain.id };
}

export async function handleShopifyWebhook(topic: string, shopHeader: string | null) {
  const shop = normalizeShop(shopHeader ?? "");
  if (!shop) return;
  // We keep no customer data, so the mandatory privacy topics need no work beyond acknowledging them.
  if (topic === "app/uninstalled" || topic === "shop/redact") await db.shopifyConnection.deleteMany({ where: { shop } });
}
