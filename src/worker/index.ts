import "dotenv/config";
import { db } from "@/lib/db";
import type { JobPayloads } from "@/lib/queue";
import { runCrawl } from "@/worker/crawl";
import { runVisibility } from "@/worker/visibility/run";
import { runDueSchedules } from "@/worker/scheduler";
import { crawlAlerts, visibilityAlerts } from "@/worker/alerts";
import { truthCheck } from "@/worker/truth";
import { runJudge } from "@/worker/judge";
import { deliverAlerts, deliverDueReports } from "@/lib/notify";

const POLL_MS = 2000;
const MAX_ATTEMPTS = 3;
const STALE_LOCK_MS = 15 * 60 * 1000;

async function claimNextJob() {
  const candidate = await db.job.findFirst({
    where: { status: "queued", runAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return null;
  // Conditional update so two workers can never both claim the same job.
  const claimed = await db.job.updateMany({
    where: { id: candidate.id, status: "queued" },
    data: { status: "running", lockedAt: new Date(), attempts: { increment: 1 } },
  });
  return claimed.count === 1 ? db.job.findUnique({ where: { id: candidate.id } }) : null;
}

async function requeueStaleJobs() {
  await db.job.updateMany({
    where: { status: "running", lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
    data: { status: "queued", lockedAt: null },
  });
}

// The audit or run has already succeeded by the time alerts are computed; an alert bug must not fail or retry the job.
async function safeAlerts(fn: () => Promise<number>) {
  try {
    await fn();
  } catch (err) {
    console.error("[worker] alerts:", err);
  }
}

async function execute(type: string, payload: unknown) {
  switch (type) {
    case "crawl": {
      const { crawlId } = payload as JobPayloads["crawl"];
      await runCrawl(crawlId);
      return safeAlerts(() => crawlAlerts(crawlId));
    }
    case "visibility": {
      const { runId } = payload as JobPayloads["visibility"];
      await runVisibility(runId);
      await safeAlerts(() => visibilityAlerts(runId));
      return safeAlerts(() => truthCheck(runId));
    }
    case "judge":
      return runJudge((payload as JobPayloads["judge"]).judgeRunId);
    default:
      throw new Error(`Unknown job type: ${type}`);
  }
}

async function processJob(job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>) {
  const payload = JSON.parse(job.payload);
  try {
    await execute(job.type, payload);
    await db.job.update({ where: { id: job.id }, data: { status: "completed", finishedAt: new Date() } });
    console.log(`[worker] ${job.type} ${job.id} completed`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Visibility and judge runs spend money on every call, so they never retry automatically.
    const finalFailure = job.attempts >= MAX_ATTEMPTS || job.type === "visibility" || job.type === "judge";
    await db.job.update({
      where: { id: job.id },
      data: finalFailure
        ? { status: "failed", error: message, finishedAt: new Date() }
        : { status: "queued", error: message, lockedAt: null, runAt: new Date(Date.now() + 30_000 * job.attempts) },
    });
    if (finalFailure && job.type === "crawl") {
      await db.crawl.update({
        where: { id: (payload as JobPayloads["crawl"]).crawlId },
        data: { status: "failed", error: message, finishedAt: new Date() },
      });
    }
    if (finalFailure && job.type === "visibility") {
      await db.visibilityRun.update({
        where: { id: (payload as JobPayloads["visibility"]).runId },
        data: { status: "failed", error: message, finishedAt: new Date() },
      });
    }
    if (finalFailure && job.type === "judge") {
      await db.judgeRun.update({
        where: { id: (payload as JobPayloads["judge"]).judgeRunId },
        data: { status: "failed", error: message, finishedAt: new Date() },
      });
    }
    console.error(`[worker] ${job.type} ${job.id} failed (attempt ${job.attempts}): ${message}`);
  }
}

// Jobs run in parallel up to WORKER_CONCURRENCY; claiming is atomic, so several workers can also run side by side.
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`[worker] started, polling for jobs (concurrency ${CONCURRENCY})`);
  let running = true;
  process.on("SIGINT", () => (running = false));
  process.on("SIGTERM", () => (running = false));
  const active = new Set<Promise<void>>();
  let lastMail = 0;
  while (running) {
    // Email runs every 30 seconds, not every poll.
    if (Date.now() - lastMail > 30_000) {
      lastMail = Date.now();
      await deliverAlerts().catch((err) => console.error("[worker] alert email:", err));
      await deliverDueReports().catch((err) => console.error("[worker] reports:", err));
    }
    await requeueStaleJobs();
    await runDueSchedules().catch((err) => console.error("[worker] scheduler:", err));
    let claimed = false;
    while (active.size < CONCURRENCY) {
      const job = await claimNextJob();
      if (!job) break;
      claimed = true;
      const p: Promise<void> = processJob(job).finally(() => active.delete(p));
      active.add(p);
    }
    // Wake when a slot frees up or after the poll interval, whichever is first.
    if (!claimed || active.size >= CONCURRENCY) await Promise.race([sleep(POLL_MS), ...active]);
  }
  await Promise.all(active); // finish in-flight jobs before exiting
  await db.$disconnect();
}

main();
