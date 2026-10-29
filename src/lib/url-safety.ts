import { lookup } from "node:dns/promises";
import net from "node:net";

export class UnsafeUrlError extends Error {}

const blockedList = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedList.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  // IPv4-mapped (URL parsing rewrites ::ffff:10.0.0.1 to ::ffff:a00:1, so a prefix strip misses it) and NAT64.
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
] as const) {
  blockedList.addSubnet(addr, prefix, "ipv6");
}

function isBlockedIp(ip: string) {
  const lower = ip.toLowerCase();
  // Dotted IPv4-mapped form is checked as the IPv4 address; hex forms (::ffff:a00:1) hit the ::ffff:0:0/96 rule.
  const mapped = lower.startsWith("::ffff:") && net.isIPv4(lower.slice(7)) ? lower.slice(7) : lower;
  return blockedList.check(mapped, net.isIPv4(mapped) ? "ipv4" : "ipv6");
}

// Turns user input like "example.com" or "https://example.com/path" into a bare public hostname.
export function normalizeHostname(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid website address.");
  }
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || net.isIP(host) || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost") {
    throw new UnsafeUrlError("Enter a public website domain, like example.com.");
  }
  return host;
}

// Guards every outbound fetch against hitting internal networks (SSRF), including via redirects.
export async function assertPublicUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  // Test-only: lets the end-to-end suite crawl a fixture server on localhost. Never honoured in production.
  if (process.env.NODE_ENV === "test" && process.env.AUDIT_TEST_ALLOW_PRIVATE === "1") return;
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError(`Blocked protocol: ${url.protocol}`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) {
    throw new UnsafeUrlError(`Blocked non-public address for ${url.hostname}`);
  }
}
