import { db } from "@/lib/db";
import { monthStart, planForOrg } from "@/lib/plans";
import { usageThisMonth } from "@/lib/usage";

// Staff are listed by email in STAFF_EMAILS (comma-separated). Kept out of the database on purpose: granting
// cross-customer access should take a deploy, not a row edit.
export function isStaff(email: string) {
  const list = (process.env.STAFF_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export async function workspaceOverview(now = new Date()) {
  const since = monthStart(now);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const orgs = await db.organization.findMany({ orderBy: { createdAt: "desc" }, include: { parent: true, _count: { select: { domains: true, clients: true } } } });
  const costs = await db.apiCallLog.groupBy({ by: ["orgId"], where: { createdAt: { gte: since } }, _sum: { costMicros: true } });
  const failed = await db.job.groupBy({ by: ["orgId"], where: { status: "failed", finishedAt: { gte: weekAgo } }, _count: { _all: true } });
  const alerts = await db.alert.groupBy({ by: ["orgId"], where: { readAt: null }, _count: { _all: true } });
  const cost = new Map(costs.map((c) => [c.orgId, c._sum.costMicros ?? 0]));
  const fails = new Map(failed.map((f) => [f.orgId, f._count._all]));
  const unread = new Map(alerts.map((a) => [a.orgId, a._count._all]));
  return Promise.all(
    orgs.map(async (o) => {
      const plan = planForOrg(o);
      const usage = await usageThisMonth(o.id, now);
      return {
        id: o.id,
        name: o.name,
        kind: o.kind,
        agency: o.parent?.name ?? null,
        plan: plan.name,
        planStatus: o.planStatus,
        sites: o._count.domains,
        clients: o._count.clients,
        answers: usage.answers,
        answerQuota: plan.monthlyAnswers,
        costMicros: cost.get(o.id) ?? 0,
        failedJobs7d: fails.get(o.id) ?? 0,
        unreadAlerts: unread.get(o.id) ?? 0,
        // Flags for the team: near quota, recent failures, or a paid plan with nothing set up.
        attention: [
          usage.answers >= plan.monthlyAnswers * 0.9 ? "near quota" : null,
          (fails.get(o.id) ?? 0) > 0 ? "failed jobs" : null,
          o.planStatus === "past_due" ? "payment past due" : null,
          o.planStatus === "active" && o._count.domains === 0 ? "paid, no sites" : null,
        ].filter((x): x is string => x !== null),
        createdAt: o.createdAt,
      };
    }),
  );
}
