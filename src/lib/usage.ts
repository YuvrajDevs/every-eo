import { db } from "@/lib/db";
import { monthStart, planForOrg } from "@/lib/plans";

export async function usageThisMonth(orgId: string, now = new Date()) {
  const since = monthStart(now);
  const [visibilityAnswers, judgeAnswers, audits, fixes, sites] = await Promise.all([
    db.visibilityResult.count({ where: { run: { orgId }, createdAt: { gte: since } } }),
    db.judgeResult.count({ where: { run: { orgId, createdAt: { gte: since } } } }),
    db.crawl.count({ where: { orgId, createdAt: { gte: since } } }),
    db.fix.count({ where: { orgId, appliedAt: { gte: since } } }),
    db.domain.count({ where: { orgId } }),
  ]);
  // Extractability judgements are AI answers too, so they share the monthly quota.
  return { answers: visibilityAnswers + judgeAnswers, audits, fixes, sites };
}

// Answers a run will use: every prompt × engine × trial. Checked before starting so a run never overshoots the quota.
export async function checkAnswerQuota(org: { id: string; plan: string; kind: string; parent?: { plan: string } | null }, needed: number) {
  const plan = planForOrg(org);
  const { answers } = await usageThisMonth(org.id);
  if (answers + needed > plan.monthlyAnswers) {
    return `This check needs ${needed} AI answers, but your ${plan.name} plan has ${Math.max(0, plan.monthlyAnswers - answers)} of ${plan.monthlyAnswers} left this month.`;
  }
  return null;
}
