// Local load test: N audits of the fixture site processed by real worker processes. Reports throughput and checks
// every audit completed exactly once with no duplicate pages. Run: npx tsx scripts/load-test.ts [audits] [concurrency] [workers]
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { startFixture } from "../tests/fixture";

const AUDITS = Number(process.argv[2] ?? 20);
const CONCURRENCY = Number(process.argv[3] ?? 4);
const WORKERS = Number(process.argv[4] ?? 1);
const DB = "file:./load-test.db";
process.env.DATABASE_URL = DB;

async function main() {
  fs.rmSync("load-test.db", { force: true });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: DB } });
  const fixture = await startFixture();
  const { db } = await import("@/lib/db");
  const { enqueueJob } = await import("@/lib/queue");
  for (let i = 0; i < AUDITS; i++) {
    const org = await db.organization.create({ data: { name: `Load ${i}` } });
    const domain = await db.domain.create({ data: { orgId: org.id, hostname: "localhost" } });
    const crawl = await db.crawl.create({ data: { orgId: org.id, domainId: domain.id } });
    await enqueueJob(org.id, "crawl", { crawlId: crawl.id });
  }
  const env = { ...process.env, DATABASE_URL: DB, NODE_ENV: "test" as const, AUDIT_TEST_ALLOW_PRIVATE: "1", RENDER_CHECK: "off", PSI_API_KEY: "", WORKER_CONCURRENCY: String(CONCURRENCY) };
  const started = Date.now();
  const procs = Array.from({ length: WORKERS }, () => spawn("npx", ["tsx", "src/worker/index.ts"], { env, stdio: "ignore", detached: true }));
  let done = 0;
  while (Date.now() - started < 10 * 60_000) {
    done = await db.crawl.count({ where: { status: { in: ["completed", "failed"] } } });
    if (done === AUDITS) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const seconds = (Date.now() - started) / 1000;
  for (const p of procs) {
    try {
      process.kill(-p.pid!, "SIGKILL");
    } catch {}
  }
  const completed = await db.crawl.count({ where: { status: "completed" } });
  const failed = await db.crawl.findMany({ where: { status: "failed" }, select: { error: true } });
  const pages = await db.page.count();
  const perCrawl = await db.page.groupBy({ by: ["crawlId"], _count: { _all: true } });
  const dupes: { n: number }[] = await db.$queryRawUnsafe('SELECT COUNT(*) AS n FROM (SELECT crawlId, url FROM Page GROUP BY crawlId, url HAVING COUNT(*) > 1)');
  const jobs = await db.job.groupBy({ by: ["status"], _count: { _all: true } });
  console.log(JSON.stringify({
    audits: AUDITS,
    workers: WORKERS,
    concurrencyPerWorker: CONCURRENCY,
    seconds: Number(seconds.toFixed(1)),
    auditsPerMinute: Number(((done / seconds) * 60).toFixed(1)),
    completed,
    failed: failed.length,
    failures: [...new Set(failed.map((f) => f.error))],
    pages,
    pagesPerAudit: [...new Set(perCrawl.map((p) => p._count._all))],
    duplicatePages: Number(dupes[0]?.n ?? 0),
    jobs: Object.fromEntries(jobs.map((j) => [j.status, j._count._all])),
  }, null, 2));
  fixture.close();
  await db.$disconnect();
  fs.rmSync("load-test.db", { force: true });
  process.exit(completed === AUDITS && Number(dupes[0]?.n ?? 0) === 0 ? 0 : 1);
}

main();
