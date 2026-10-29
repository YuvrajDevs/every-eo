import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/queue";
import { configuredEngines } from "@/lib/engines";
import { planForOrg } from "@/lib/plans";
import { checkAnswerQuota } from "@/lib/usage";

// Shared by the dashboard (on click) and the worker's scheduler, so both follow the same rules.

export async function startCrawl(orgId: string, domainId: string) {
  const active = await db.crawl.findFirst({ where: { orgId, domainId, status: { in: ["queued", "running"] } } });
  if (active) return active.id;
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, include: { parent: true } });
  const crawl = await db.crawl.create({ data: { orgId, domainId, maxPages: planForOrg(org).pagesPerAudit } });
  await enqueueJob(orgId, "crawl", { crawlId: crawl.id });
  return crawl.id;
}

export type StartVisibilityResult = { runId: string } | { error: string };

export async function startVisibility(orgId: string, domainId: string, trials: number): Promise<StartVisibilityResult> {
  const engines = configuredEngines();
  if (engines.length === 0) return { error: "Add at least one AI engine API key first." };
  const prompts = await db.prompt.count({ where: { domainId } });
  if (prompts === 0) return { error: "Add at least one question to track." };
  const active = await db.visibilityRun.findFirst({ where: { domainId, status: { in: ["queued", "running"] } } });
  if (active) return { error: "A check is already running for this site." };
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, include: { parent: true } });
  const plan = planForOrg(org);
  if (trials > plan.maxTrials) return { error: `Your ${plan.name} plan allows up to ${plan.maxTrials} repeats per question.` };
  const quota = await checkAnswerQuota(org, prompts * engines.length * trials);
  if (quota) return { error: quota };
  const run = await db.visibilityRun.create({ data: { orgId, domainId, trials, engines: engines.map((e) => e.id).join(",") } });
  await enqueueJob(orgId, "visibility", { runId: run.id });
  return { runId: run.id };
}

export const SCHEDULES = ["off", "weekly", "monthly"] as const;
export type Schedule = (typeof SCHEDULES)[number];

export function nextRun(schedule: string, from: Date): Date | null {
  if (schedule === "weekly") return new Date(from.getTime() + 7 * 86_400_000);
  if (schedule === "monthly") {
    const d = new Date(from);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d;
  }
  return null;
}
