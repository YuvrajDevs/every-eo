import { db } from "@/lib/db";
import { monthStart, planFor } from "@/lib/plans";

export async function usageThisMonth(orgId: string, now = new Date()) {
  const since = monthStart(now);
  const [answers, audits, fixes, sites] = await Promise.all([
    db.visibilityResult.count({ where: { run: { orgId }, createdAt: { gte: since } } }),
    db.crawl.count({ where: { orgId, createdAt: { gte: since } } }),
    db.fix.count({ where: { orgId, appliedAt: { gte: since } } }),
    db.domain.count({ where: { orgId } }),
  ]);
  return { answers, audits, fixes, sites };
}

// Answers a run will use: every prompt × engine × trial. Checked before starting so a run never overshoots the quota.
export async function checkAnswerQuota(org: { id: string; plan: string }, needed: number) {
  const plan = planFor(org.plan);
  const { answers } = await usageThisMonth(org.id);
  if (answers + needed > plan.monthlyAnswers) {
    return `This check needs ${needed} AI answers, but your ${plan.name} plan has ${Math.max(0, plan.monthlyAnswers - answers)} of ${plan.monthlyAnswers} left this month.`;
  }
  return null;
}
