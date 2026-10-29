import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/queue";
import { engineInfo } from "@/lib/engines";

// Free audits are deliberately smaller than paid ones, and a finished audit of the same site is reused for a day.
export const PUBLIC_MAX_PAGES = 15;
export const PUBLIC_REUSE_MS = 24 * 60 * 60_000;
export const PUBLIC_AI_TRIALS = 3;
export const PUBLIC_PER_IP_PER_HOUR = 5;

// Caps how many free AI checks run per day so a free Gemini quota can't be drained by strangers.
export function publicAiDailyLimit() {
  return Math.max(0, Number(process.env.PUBLIC_AI_DAILY_LIMIT ?? 30) || 0);
}

export type PublicAiResult = {
  engine: string;
  model?: string;
  webSearch?: boolean;
  mentioned?: number;
  total?: number;
  excerpts?: { mentioned: boolean; text: string }[];
  reason?: string;
};

export function hashIp(ip: string) {
  return createHash("sha256").update(`public-audit:${ip}`).digest("hex").slice(0, 32);
}

// Hidden workspace that owns free-audit crawls. It has no members, so no one can open it in the dashboard.
export async function publicOrg() {
  const existing = await db.organization.findFirst({ where: { kind: "public" } });
  return existing ?? db.organization.create({ data: { name: "Free public audits", kind: "public" } });
}

export async function createPublicAudit(hostname: string, question: string | null, ip: string) {
  const org = await publicOrg();
  const domain = await db.domain.upsert({
    where: { orgId_hostname: { orgId: org.id, hostname } },
    update: {},
    create: { orgId: org.id, hostname },
  });

  let crawl = await db.crawl.findFirst({
    where: {
      domainId: domain.id,
      OR: [{ status: { in: ["queued", "running"] } }, { status: "completed", createdAt: { gte: new Date(Date.now() - PUBLIC_REUSE_MS) } }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (!crawl) {
    crawl = await db.crawl.create({ data: { orgId: org.id, domainId: domain.id, maxPages: PUBLIC_MAX_PAGES } });
    await enqueueJob(org.id, "crawl", { crawlId: crawl.id });
  }

  let aiStatus = "none";
  let aiResult: PublicAiResult | null = null;
  if (question) {
    const gemini = engineInfo("gemini");
    const usedToday = await db.publicAudit.count({
      where: { aiStatus: { in: ["queued", "running", "done", "failed"] }, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
    });
    if (!gemini || !process.env[gemini.envKey]) {
      aiStatus = "skipped";
      aiResult = { engine: "gemini", reason: "The AI check isn't switched on for free audits right now." };
    } else if (usedToday >= publicAiDailyLimit()) {
      aiStatus = "skipped";
      aiResult = { engine: "gemini", reason: "Today's free AI checks are used up. Create a free account to run one, or try again tomorrow." };
    } else {
      aiStatus = "queued";
    }
  }

  const audit = await db.publicAudit.create({
    data: { hostname, crawlId: crawl.id, question, aiStatus, aiResult: aiResult ? JSON.stringify(aiResult) : null, ipKey: hashIp(ip) },
  });
  if (aiStatus === "queued") await enqueueJob(org.id, "publicAi", { publicAuditId: audit.id });
  return audit;
}
