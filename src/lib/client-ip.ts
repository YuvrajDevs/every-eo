// The client's IP for rate limiting. X-Forwarded-For is a list each proxy appends to, so anything to the left of
// the entries your own proxies added can be forged by the client. With TRUST_PROXY_HOPS = n (default 1: one proxy
// or load balancer in front of the app), the n-th entry from the right is the address that proxy actually saw.
// With 0 (app exposed directly), forwarding headers are ignored entirely.
export function clientIpFrom(headers: Headers) {
  const hops = Math.max(0, Number(process.env.TRUST_PROXY_HOPS ?? 1) || 0);
  if (hops === 0) return "direct";
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain.length >= hops) return chain[chain.length - hops];
  return headers.get("x-real-ip")?.trim() || "unknown";
}
