import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { healthScore } from "@/lib/health";
import { planForOrg } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";
import { wilson } from "@/lib/stats";

export const API_RATE_LIMIT = 120; // requests per minute per key

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createApiKey(orgId: string, name: string) {
  const key = `vis_${randomBytes(24).toString("base64url")}`;
  const row = await db.apiKey.create({ data: { orgId, name: name.slice(0, 60) || "API key", prefix: key.slice(0, 12), hash: hashKey(key) } });
  return { key, row }; // the full key is returned once and never stored
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// Bearer key → workspace. Agency keys may act on one of their client workspaces via X-Workspace.
export async function authenticate(headers: Headers) {
  const auth = headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!key.startsWith("vis_")) throw new ApiError(401, "unauthorized", "Send your API key as: Authorization: Bearer vis_…");
  const row = await db.apiKey.findUnique({ where: { hash: hashKey(key) }, include: { org: { include: { parent: true } } } });
  if (!row || row.revokedAt) throw new ApiError(401, "unauthorized", "Unknown or revoked API key.");
  if (!planForOrg(row.org).api) throw new ApiError(403, "plan", "API access isn't included in this workspace's plan.");
  const limit = rateLimit(`api:${row.id}`, API_RATE_LIMIT, 60_000);
  if (!limit.ok) throw new ApiError(429, "rate_limited", `Limit is ${API_RATE_LIMIT} requests per minute. Retry in ${Math.ceil(limit.resetMs / 1000)}s.`);
  await db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  const target = headers.get("x-workspace");
  if (target && target !== row.orgId) {
    const client = await db.organization.findFirst({ where: { id: target, parentId: row.orgId, kind: "client" } });
    if (!client) throw new ApiError(404, "not_found", "No such client workspace for this key.");
    return { orgId: client.id, keyOrgId: row.orgId };
  }
  return { orgId: row.orgId, keyOrgId: row.orgId };
}

export async function listClients(keyOrgId: string) {
  const rows = await db.organization.findMany({ where: { parentId: keyOrgId, kind: "client" }, orderBy: { name: "asc" }, select: { id: true, name: true, createdAt: true } });
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt.toISOString() }));
}

export async function listSites(orgId: string) {
  const domains = await db.domain.findMany({
    where: { orgId },
    orderBy: { hostname: "asc" },
    include: { crawls: { where: { status: "completed" }, orderBy: { createdAt: "desc" }, take: 1, include: { findings: { select: { severity: true, fixability: true } } } } },
  });
  return domains.map((d) => ({
    id: d.id,
    hostname: d.hostname,
    latestAudit: d.crawls[0] ? { id: d.crawls[0].id, completedAt: d.crawls[0].finishedAt?.toISOString() ?? null, health: healthScore(d.crawls[0].findings), findings: d.crawls[0].findings.length } : null,
  }));
}

async function ownedDomain(orgId: string, siteId: string) {
  const d = await db.domain.findFirst({ where: { id: siteId, orgId } });
  if (!d) throw new ApiError(404, "not_found", "No such site in this workspace.");
  return d;
}

export async function siteAudit(orgId: string, siteId: string) {
  const d = await ownedDomain(orgId, siteId);
  const crawl = await db.crawl.findFirst({ where: { domainId: d.id, status: "completed" }, orderBy: { createdAt: "desc" }, include: { findings: true } });
  if (!crawl) throw new ApiError(404, "no_audit", "This site has no completed audit yet.");
  return {
    site: d.hostname,
    auditId: crawl.id,
    completedAt: crawl.finishedAt?.toISOString() ?? null,
    platform: crawl.platform,
    pages: crawl.pagesCount,
    health: healthScore(crawl.findings),
    findings: crawl.findings.map((f) => ({ code: f.code, layer: f.layer, severity: f.severity, evidence: f.evidence, fixability: f.fixability, title: f.title, detail: f.detail, url: f.url, howTo: f.howTo })),
  };
}

export async function siteVisibility(orgId: string, siteId: string) {
  const d = await ownedDomain(orgId, siteId);
  const run = await db.visibilityRun.findFirst({
    where: { domainId: d.id, status: "completed", results: { some: { error: null } } },
    orderBy: { createdAt: "desc" },
    include: { results: true },
  });
  if (!run) throw new ApiError(404, "no_visibility", "This site has no completed AI visibility check yet.");
  const ok = run.results.filter((r) => !r.error);
  const rate = (rs: typeof ok) => {
    const ci = wilson(rs.filter((r) => r.mentioned).length, rs.length);
    const cited = wilson(rs.filter((r) => r.cited).length, rs.length);
    return { answers: rs.length, mentionRate: ci.rate, mentionLow: ci.low, mentionHigh: ci.high, citedRate: cited.rate, citedLow: cited.low, citedHigh: cited.high };
  };
  const engines = [...new Set(ok.map((r) => r.engine))];
  return { site: d.hostname, runId: run.id, checkedAt: run.createdAt.toISOString(), trials: run.trials, overall: rate(ok), byEngine: Object.fromEntries(engines.map((e) => [e, rate(ok.filter((r) => r.engine === e))])) };
}

// Wraps a handler: JSON responses, consistent error shape, no stack traces leaked.
export async function respond(fn: () => Promise<unknown>) {
  try {
    return Response.json({ data: await fn() });
  } catch (err) {
    if (err instanceof ApiError) return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status, headers: err.status === 429 ? { "retry-after": "60" } : undefined });
    console.error("[api]", err);
    return Response.json({ error: { code: "internal", message: "Something went wrong." } }, { status: 500 });
  }
}
