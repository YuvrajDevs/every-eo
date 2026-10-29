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
] as const) {
  blockedList.addSubnet(addr, prefix, "ipv6");
}

// IPv4 carried inside IPv6: mapped (::ffff:a.b.c.d, which URL parsing rewrites as ::ffff:a00:1) and NAT64 (64:ff9b::).
// Decoded by hand and checked against the IPv4 rules. A ::ffff:0:0/96 entry in the BlockList would be wrong: Node
// matches plain IPv4 addresses against it, which blocks every public IPv4 site.
function embeddedIPv4(ip: string) {
  const m = ip.toLowerCase().match(/^(?:::ffff:|64:ff9b::)(?:([0-9a-f]{1,4}):([0-9a-f]{1,4})|(\d{1,3}(?:\.\d{1,3}){3}))$/);
  if (!m) return null;
  if (m[3]) return m[3];
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

function isBlockedIp(ip: string) {
  if (net.isIPv4(ip)) return blockedList.check(ip, "ipv4");
  const v4 = embeddedIPv4(ip);
  if (v4) return blockedList.check(v4, "ipv4");
  return blockedList.check(ip, "ipv6");
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

type Resolved = { address: string; family: number };
type LookupCallback = (err: Error | null, address: string | Resolved[], family?: number) => void;

// DNS lookup used for the actual outbound connection. Validating here (rather than only before the request) closes
// the DNS-rebinding gap: the address that gets connected to is the address that was checked.
export function makeSafeLookup(resolve: (host: string) => Promise<Resolved[]> = (h) => lookup(h, { all: true })) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback) => {
    const all = typeof options === "object" && options?.all;
    resolve(hostname)
      .then((addrs) => {
        const bypass = process.env.NODE_ENV === "test" && process.env.AUDIT_TEST_ALLOW_PRIVATE === "1";
        if (addrs.length === 0) return callback(new UnsafeUrlError(`No address for ${hostname}`), "");
        if (!bypass && addrs.some((a) => isBlockedIp(a.address))) return callback(new UnsafeUrlError(`Blocked non-public address for ${hostname}`), "");
        if (all) callback(null, addrs);
        else callback(null, addrs[0].address, addrs[0].family);
      })
      .catch((err: Error) => callback(err, ""));
  };
}
