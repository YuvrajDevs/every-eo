import { NextResponse, type NextRequest } from "next/server";
import { clientIpFrom } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";

// Runs before every page, action and API route: per-IP rate limits and security headers (including a per-request
// CSP nonce). Per-account limits live next to the actions and API keys they protect.

const LIMITS: { test: (req: NextRequest) => boolean; name: string; max: number; windowMs: number }[] = [
  // Login and sign-up POSTs (server actions on those pages).
  { name: "auth", test: (r) => r.method === "POST" && (r.nextUrl.pathname === "/login" || r.nextUrl.pathname === "/signup"), max: 20, windowMs: 60_000 },
  { name: "verify", test: (r) => r.nextUrl.pathname === "/verify", max: 20, windowMs: 60_000 },
  { name: "plugin", test: (r) => r.nextUrl.pathname === "/api/plugin", max: 20, windowMs: 60_000 },
  { name: "webhook", test: (r) => r.nextUrl.pathname.startsWith("/api/stripe") || r.nextUrl.pathname.startsWith("/api/shopify/webhooks"), max: 300, windowMs: 60_000 },
  { name: "api", test: (r) => r.nextUrl.pathname.startsWith("/api/v1"), max: 300, windowMs: 60_000 },
  { name: "write", test: (r) => r.method !== "GET" && r.method !== "HEAD", max: 300, windowMs: 60_000 },
  // Generous: offices and agencies often share one IP. Link prefetches don't count (one page view can trigger many).
  { name: "all", test: (r) => !r.headers.has("next-router-prefetch"), max: 1200, windowMs: 60_000 },
];

// Largest request accepted anywhere (CSV imports are the biggest legitimate uploads at 2 MB).
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function proxy(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return new NextResponse("Request too large.", { status: 413, headers: { "content-type": "text/plain; charset=utf-8" } });
  const ip = clientIpFrom(request.headers);
  for (const l of LIMITS) {
    if (!l.test(request)) continue;
    const r = rateLimit(`ip:${l.name}:${ip}`, l.max, l.windowMs);
    if (!r.ok) {
      return new NextResponse("Too many requests. Slow down and try again shortly.", {
        status: 429,
        headers: { "retry-after": String(Math.ceil(r.resetMs / 1000)), "content-type": "text/plain; charset=utf-8" },
      });
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-inline'" : ""}`,
    "style-src-attr 'unsafe-inline'", // React style={{}} attributes (charts, meters, brand colour)
    "img-src 'self' data: blob: https:", // agency logos are external https images
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Server-action redirects without JavaScript can continue to Stripe checkout or a Shopify store.
    "form-action 'self' https://checkout.stripe.com https://billing.stripe.com https://*.myshopify.com",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // Static build assets and the favicon don't need nonces; they get the static headers from next.config.ts.
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
