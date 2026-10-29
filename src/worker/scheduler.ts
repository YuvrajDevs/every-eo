import { db } from "@/lib/db";
import { nextRun, startCrawl, startVisibility } from "@/lib/jobs";

// Starts any scheduled audits or visibility checks that are due, then moves each due date forward.
// The due date always advances, even if the start is skipped (e.g. no prompts), so nothing retries every poll.
export async function runDueSchedules(now = new Date()) {
  let started = 0;
  const dueAudits = await db.domain.findMany({ where: { auditSchedule: { not: "off" }, nextAuditAt: { lte: now } } });
  for (const d of dueAudits) {
    const claimed = await db.domain.updateMany({
      where: { id: d.id, nextAuditAt: d.nextAuditAt },
      data: { nextAuditAt: nextRun(d.auditSchedule, now) },
    });
    if (claimed.count === 0) continue; // another worker took it
    await startCrawl(d.orgId, d.id);
    started++;
  }
  const dueVisibility = await db.domain.findMany({ where: { visibilitySchedule: { not: "off" }, nextVisibilityAt: { lte: now } } });
  for (const d of dueVisibility) {
    const claimed = await db.domain.updateMany({
      where: { id: d.id, nextVisibilityAt: d.nextVisibilityAt },
      data: { nextVisibilityAt: nextRun(d.visibilitySchedule, now) },
    });
    if (claimed.count === 0) continue;
    const res = await startVisibility(d.orgId, d.id, d.visibilityTrials);
    if ("runId" in res) started++;
    else if (!res.error.includes("already running")) {
      // Tell the owner rather than silently skipping: a missed check looks like "no change" otherwise.
      await db.alert.create({
        data: { orgId: d.orgId, domainId: d.id, kind: "schedule_skipped", title: `Scheduled AI check for ${d.hostname} didn't run`, detail: res.error, link: `/dashboard/visibility/${d.id}` },
      });
    }
  }
  return started;
}
