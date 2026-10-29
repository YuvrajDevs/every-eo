import { db } from "@/lib/db";
import { engineInfo } from "@/lib/engines";
import { pct, wilson } from "@/lib/stats";
import type { BotAccessResult } from "@/lib/ai-bots";

type Rate = { hits: number; n: number };

function rates(results: { promptId: string; engine: string; mentioned: boolean; cited: boolean; error: string | null }[]) {
  const map = new Map<string, { mentioned: Rate; cited: Rate }>();
  for (const r of results) {
    if (r.error) continue;
    const key = `${r.promptId}|${r.engine}`;
    const e = map.get(key) ?? { mentioned: { hits: 0, n: 0 }, cited: { hits: 0, n: 0 } };
    e.mentioned.n++;
    e.cited.n++;
    if (r.mentioned) e.mentioned.hits++;
    if (r.cited) e.cited.hits++;
    map.set(key, e);
  }
  return map;
}

// A drop only counts when the two 95% ranges don't overlap. With 5 trials that means roughly
// "usually mentioned" → "rarely mentioned"; smaller wobbles are normal AI variance, not a lost citation.
export function significantDrop(before: Rate, after: Rate) {
  if (before.n === 0 || after.n === 0) return false;
  return wilson(after.hits, after.n).high < wilson(before.hits, before.n).low;
}

const RECOVERY =
  "What to check: 1) re-run the site audit and confirm AI search bots can still reach you; 2) see which sites are now cited instead on the visibility page; 3) refresh the page that used to be cited with current facts, a direct answer near the top, and dated statistics.";

export async function visibilityAlerts(runId: string) {
  const run = await db.visibilityRun.findUniqueOrThrow({ where: { id: runId }, include: { results: true } });
  const previous = await db.visibilityRun.findFirst({
    where: { domainId: run.domainId, status: "completed", id: { not: run.id }, createdAt: { lt: run.createdAt } },
    orderBy: { createdAt: "desc" },
    include: { results: true },
  });
  if (!previous) return 0;
  const before = rates(previous.results);
  const after = rates(run.results);
  const prompts = new Map((await db.prompt.findMany({ where: { domainId: run.domainId } })).map((p) => [p.id, p.text]));
  const alerts = [];
  for (const [key, now] of after) {
    const was = before.get(key);
    const [promptId, engine] = key.split("|");
    if (!was || !prompts.has(promptId)) continue;
    const label = engineInfo(engine)?.label ?? engine;
    for (const metric of ["cited", "mentioned"] as const) {
      if (!significantDrop(was[metric], now[metric])) continue;
      const w = wilson(was[metric].hits, was[metric].n);
      const n = wilson(now[metric].hits, now[metric].n);
      alerts.push({
        orgId: run.orgId,
        domainId: run.domainId,
        kind: "visibility_drop",
        title: `${label} ${metric === "cited" ? "stopped linking to you" : "stopped mentioning you"} for “${prompts.get(promptId)!.slice(0, 80)}”`,
        detail: `${metric === "cited" ? "Linked" : "Mentioned"} in ${was[metric].hits}/${was[metric].n} answers last time (likely ${pct(w.low)}–${pct(w.high)}), now ${now[metric].hits}/${now[metric].n} (likely ${pct(n.low)}–${pct(n.high)}). The ranges don't overlap, so this is unlikely to be normal variation. ${RECOVERY}`,
        link: `/dashboard/visibility/${run.domainId}`,
      });
      break; // one alert per question and engine; "cited" is the stronger signal
    }
  }
  if (alerts.length) await db.alert.createMany({ data: alerts });
  return alerts.length;
}

export async function crawlAlerts(crawlId: string) {
  const crawl = await db.crawl.findUniqueOrThrow({ where: { id: crawlId }, include: { findings: true, robots: true, domain: true } });
  const previous = await db.crawl.findFirst({
    where: { domainId: crawl.domainId, status: "completed", id: { not: crawl.id }, createdAt: { lt: crawl.createdAt } },
    orderBy: { createdAt: "desc" },
    include: { findings: true, robots: true },
  });
  if (!previous) return 0;
  const alerts = [];
  const link = `/dashboard/crawls/${crawl.id}`;
  const bots = (r: { botAccess: string } | null): BotAccessResult[] => (r ? JSON.parse(r.botAccess) : []);
  const wasOpen = new Set(bots(previous.robots).filter((b) => b.allowed && b.reachable !== false).map((b) => b.userAgent));
  for (const b of bots(crawl.robots)) {
    if (b.purpose === "training" || !wasOpen.has(b.userAgent) || (b.allowed && b.reachable !== false)) continue;
    alerts.push({
      orgId: crawl.orgId,
      domainId: crawl.domainId,
      kind: "bot_blocked",
      title: `${b.userAgent} can no longer read ${crawl.domain.hostname}`,
      detail: `${b.engine} could reach your site on the previous audit and now ${b.allowed ? "gets rejected by your server or firewall" : "is blocked by robots.txt"}. While blocked, it can't cite you. This often follows a theme, plugin, CDN or platform setting change.`,
      link,
    });
  }
  const before = new Set(previous.findings.filter((f) => f.severity === "high").map((f) => f.code));
  for (const f of crawl.findings) {
    if (f.severity !== "high" || before.has(f.code) || f.code.startsWith("bot_blocked_") || f.code.startsWith("firewall_blocks_")) continue;
    alerts.push({ orgId: crawl.orgId, domainId: crawl.domainId, kind: "new_issue", title: `New urgent issue: ${f.title}`, detail: f.detail, link });
  }
  if (alerts.length) await db.alert.createMany({ data: alerts });
  return alerts.length;
}
