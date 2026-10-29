import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { authorizeUrl, newState, normalizeShop, shopifyConfigured } from "@/lib/shopify";
import { STATE_COOKIE } from "@/lib/shopify-install";

export async function GET(req: Request) {
  const { org } = await requireUser();
  const url = new URL(req.url);
  const domainId = url.searchParams.get("domainId") ?? "";
  const back = `/dashboard/fixes/${encodeURIComponent(domainId)}`;
  if (!shopifyConfigured()) return Response.redirect(new URL(`${back}?shopify=not_configured`, url), 303);
  const domain = await db.domain.findFirst({ where: { id: domainId, orgId: org.id } });
  const shop = normalizeShop(url.searchParams.get("shop") ?? "");
  if (!domain) return new Response("Site not found", { status: 404 });
  if (!shop) return Response.redirect(new URL(`${back}?shopify=bad_shop`, url), 303);
  const state = newState();
  (await cookies()).set(STATE_COOKIE, `${state}.${domain.id}.${shop}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/shopify", maxAge: 600 });
  const base = (process.env.APP_URL ?? url.origin).replace(/\/$/, "");
  return Response.redirect(authorizeUrl(shop, state, `${base}/api/shopify/callback`), 303);
}
