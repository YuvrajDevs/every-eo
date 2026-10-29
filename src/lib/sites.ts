import "server-only";
import { db } from "@/lib/db";
import { healthScore } from "@/lib/health";
import type { BotAccessResult } from "@/lib/ai-bots";

export async function getSites(orgId: string) {
  const domains = await db.domain.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    include: {
      crawls: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { findings: { select: { severity: true, fixability: true } }, robots: { select: { botAccess: true } } },
      },
    },
  });

  return domains.map((d) => {
    const latest = d.crawls[0];
    const findings = latest?.findings ?? [];
    const bots: BotAccessResult[] = latest?.robots ? JSON.parse(latest.robots.botAccess) : [];
    const done = latest?.status === "completed";
    return {
      id: d.id,
      hostname: d.hostname,
      latest,
      score: done ? healthScore(findings) : null,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      blockedSearchBots: bots.filter((b) => !b.allowed && b.purpose !== "training").length,
    };
  });
}

export type Site = Awaited<ReturnType<typeof getSites>>[number];
