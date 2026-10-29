import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { safeRequest } from "@/lib/safe-fetch";

// Shopify app: OAuth install, request/webhook HMAC checks, and the Admin GraphQL calls the fix engine needs.
// Structured data is written to app-data metafields on the app installation; the theme app embed
// (integrations/shopify/extensions/visibility-schema) prints them in <head>.

export const SHOPIFY_SCOPES = "read_themes";
export const API_VERSION = "2025-01";
export const METAFIELD_NAMESPACE = "visibility";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeShop(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const shop = s.includes(".") ? s : `${s}.myshopify.com`;
  return SHOP_RE.test(shop) ? shop : null;
}

export const shopifyConfigured = () => Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);

// Test seam: lets integration tests point Admin API calls at a local mock. Ignored outside NODE_ENV=test.
function adminBase(shop: string) {
  return process.env.NODE_ENV === "test" && process.env.SHOPIFY_TEST_ADMIN_BASE ? process.env.SHOPIFY_TEST_ADMIN_BASE : `https://${shop}`;
}

export function newState() {
  return randomBytes(16).toString("hex");
}

export function authorizeUrl(shop: string, state: string, redirectUri: string) {
  const u = new URL(`https://${shop}/admin/oauth/authorize`);
  u.searchParams.set("client_id", process.env.SHOPIFY_API_KEY!);
  u.searchParams.set("scope", SHOPIFY_SCOPES);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

const safeEqual = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

// OAuth/app-proxy query HMAC: all params except hmac, sorted, joined as k=v&k=v, HMAC-SHA256 hex with the app secret.
export function verifyQueryHmac(params: URLSearchParams, secret = process.env.SHOPIFY_API_SECRET!) {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return safeEqual(Buffer.from(createHmac("sha256", secret).update(message).digest("hex")), Buffer.from(hmac));
}

// Webhooks: X-Shopify-Hmac-Sha256 is the base64 HMAC-SHA256 of the raw body.
export function verifyWebhookHmac(rawBody: string, header: string | null, secret = process.env.SHOPIFY_API_SECRET!) {
  if (!header) return false;
  return safeEqual(Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("base64")), Buffer.from(header));
}

export async function exchangeCode(shop: string, code: string) {
  const res = await safeRequest(`${adminBase(shop)}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_API_KEY, client_secret: process.env.SHOPIFY_API_SECRET, code }),
  });
  if (res.status !== 200) throw new Error(`Shopify refused the install (HTTP ${res.status}).`);
  const json = JSON.parse(res.body) as { access_token?: string; scope?: string };
  if (!json.access_token) throw new Error("Shopify didn't return an access token.");
  return { token: json.access_token, scopes: json.scope ?? "" };
}

export async function graphql<T>(shop: string, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await safeRequest(`${adminBase(shop)}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shopify-access-token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) throw new Error("Shopify rejected the app's access. Reinstall the app from the Fixes page.");
  if (res.status !== 200) throw new Error(`Shopify returned HTTP ${res.status}`);
  const json = JSON.parse(res.body) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data as T;
}

export async function appInstallationId(shop: string, token: string) {
  const data = await graphql<{ currentAppInstallation: { id: string } }>(shop, token, `{ currentAppInstallation { id } }`);
  return data.currentAppInstallation.id;
}

// The theme embed prints these keys verbatim; each holds ready-made <script type="application/ld+json"> tags.
export type HeadKey = "head_home" | "head_site";

export async function readHead(shop: string, token: string, ownerId: string, key: HeadKey): Promise<Record<string, string>> {
  const data = await graphql<{ appInstallation: { metafield: { value: string } | null } | null }>(
    shop,
    token,
    `query($id: ID!, $ns: String!, $key: String!) { appInstallation(id: $id) { metafield(namespace: $ns, key: $key) { value } } }`,
    { id: ownerId, ns: METAFIELD_NAMESPACE, key: `${key}_index` },
  );
  const raw = data.appInstallation?.metafield?.value;
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

// Stores both an index (fix id → tag, so single fixes can be removed) and the rendered HTML the theme reads.
export async function writeHead(shop: string, token: string, ownerId: string, key: HeadKey, entries: Record<string, string>) {
  const data = await graphql<{ metafieldsSet: { userErrors: { message: string }[] } }>(
    shop,
    token,
    `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`,
    {
      m: [
        { ownerId, namespace: METAFIELD_NAMESPACE, key: `${key}_index`, type: "json", value: JSON.stringify(entries) },
        { ownerId, namespace: METAFIELD_NAMESPACE, key, type: "multi_line_text_field", value: Object.values(entries).join("\n") || " " },
      ],
    },
  );
  if (data.metafieldsSet.userErrors.length) throw new Error(data.metafieldsSet.userErrors.map((e) => e.message).join("; "));
}

export function jsonLdTag(data: object) {
  // \u003c keeps "</script>" inside values from ending the tag.
  return `<script type="application/ld+json" data-visibility="1">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}
