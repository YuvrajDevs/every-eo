import { assertPublicUrl } from "@/lib/url-safety";

export const CRAWLER_USER_AGENT = "AEOAuditBot/0.1 (+site audit requested by the site owner)";

const MAX_REDIRECTS = 5;
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export type SafeResponse = {
  finalUrl: string;
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: string;
};

// Follows redirects manually so every hop is re-checked against internal-network addresses.
export async function safeFetch(startUrl: string, userAgent = CRAWLER_USER_AGENT): Promise<SafeResponse> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": userAgent, accept: "text/html,application/xml,text/plain;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, url).toString();
      continue;
    }
    return {
      finalUrl: url,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      headers: Object.fromEntries(res.headers),
      body: await readCapped(res),
    };
  }
  throw new Error(`Too many redirects starting from ${startUrl}`);
}

async function readCapped(res: Response) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type SafeRequest = { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number };

// For API calls to user-supplied hosts (e.g. a client's WordPress). Same internal-network guard as safeFetch, but
// redirects are not followed: a redirected POST would silently become a GET or leak credentials to another host.
export async function safeRequest(url: string, req: SafeRequest = {}) {
  await assertPublicUrl(url);
  const res = await fetch(url, {
    method: req.method ?? "GET",
    redirect: "manual",
    headers: { "user-agent": CRAWLER_USER_AGENT, ...req.headers },
    body: req.body,
    signal: AbortSignal.timeout(req.timeoutMs ?? TIMEOUT_MS),
  });
  return { status: res.status, location: res.headers.get("location"), contentType: res.headers.get("content-type") ?? "", body: await readCapped(res) };
}
