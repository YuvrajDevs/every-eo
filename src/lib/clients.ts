import { db } from "@/lib/db";
import { healthScore } from "@/lib/health";
import { usageThisMonth } from "@/lib/usage";

// One row per client workspace for the agency console.
export async function clientSummaries(agencyId: string) {
  const clients = await db.organization.findMany({
    where: { parentId: agencyId, kind: "client" },
    orderBy: { name: "asc" },
    include: {
      domains: {
        include: {
          crawls: { where: { status: "completed" }, orderBy: { createdAt: "desc" }, take: 1, include: { findings: { select: { severity: true, fixability: true } } } },
          visibilityRuns: { where: { status: "completed" }, orderBy: { createdAt: "desc" }, take: 1, include: { results: { select: { mentioned: true, error: true } } } },
        },
      },
      alerts: { where: { readAt: null }, select: { id: true } },
    },
  });
  return Promise.all(
    clients.map(async (c) => {
      const scores = c.domains.flatMap((d) => (d.crawls[0] ? [healthScore(d.crawls[0].findings)] : []));
      const answers = c.domains.flatMap((d) => d.visibilityRuns[0]?.results.filter((r) => !r.error) ?? []);
      return {
        id: c.id,
        name: c.name,
        sites: c.domains.length,
        health: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
        mentionRate: answers.length ? answers.filter((r) => r.mentioned).length / answers.length : null,
        unreadAlerts: c.alerts.length,
        answersThisMonth: (await usageThisMonth(c.id)).answers,
      };
    }),
  );
}
