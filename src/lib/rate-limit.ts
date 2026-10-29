// Fixed-window counter per key, in process memory. Good for a single server; with several instances, move this to a
// shared store (e.g. Redis INCR with expiry) so limits apply across all of them.
const windows = new Map<string, { start: number; count: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 50_000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    return { ok: true, remaining: limit - 1, resetMs: windowMs };
  }
  w.count++;
  return { ok: w.count <= limit, remaining: Math.max(0, limit - w.count), resetMs: windowMs - (now - w.start) };
}

export function resetRateLimits() {
  windows.clear();
}
