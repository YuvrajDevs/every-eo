import Link from "next/link";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSites } from "@/lib/sites";
import { ENGINES } from "@/lib/engines";
import { wilson, pct } from "@/lib/stats";
import type { BotAccessResult } from "@/lib/ai-bots";
import { AddDomainForm } from "@/components/forms";
import { SetupChecklist } from "@/components/setup-checklist";
import { Card, LayerBadge, Meter, Readout, ScoreRing, SectionTitle, SeverityBadge, StatusPill } from "@/components/ui";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function DashboardPage() {
  const { user, org } = await requireUser();
  const sites = await getSites(org.id);
  const latestIds = sites.flatMap((s) => (s.latest?.status === "completed" ? [s.latest.id] : []));

  const [urgent, robots, runs] = await Promise.all([
    db.finding.findMany({
      where: { crawlId: { in: latestIds }, severity: { in: ["high", "medium"] }, NOT: { fixability: "platform" } },
      include: { crawl: { select: { domain: { select: { hostname: true } } } } },
      take: 6,
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
    }),
    db.robotsReport.findMany({ where: { crawlId: { in: latestIds } }, select: { botAccess: true } }),
    // Latest finished AI check per site.
    Promise.all(
      sites.map((s) =>
        db.visibilityRun.findFirst({
          where: { domainId: s.id, status: "completed" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, engines: true, results: { select: { mentioned: true, engine: true, error: true } } },
        }),
      ),
    ),
  ]);

  const scored = sites.filter((s) => s.score !== null);
  const avgHealth = scored.length ? Math.round(scored.reduce((n, s) => n + (s.score ?? 0), 0) / scored.length) : null;
  const totalPages = sites.reduce((n, s) => n + (s.latest?.pagesCount ?? 0), 0);
  const totalHigh = sites.reduce((n, s) => n + s.high, 0);
  const lastAudit = sites.map((s) => s.latest?.finishedAt ?? null).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];

  // Crawler access across every site's latest audit, per AI search engine.
  const botRows = new Map<string, { engine: string; blocked: number; checked: number }>();
  for (const r of robots) {
    for (const b of JSON.parse(r.botAccess) as BotAccessResult[]) {
      if (b.purpose !== "search") continue;
      const row = botRows.get(b.userAgent) ?? { engine: b.engine, blocked: 0, checked: 0 };
      row.checked++;
      if (!b.allowed || b.reachable === false) row.blocked++;
      botRows.set(b.userAgent, row);
    }
  }
  const bots = [...botRows.values()];
  const blockedSites = sites.filter((s) => s.blockedSearchBots > 0).length;

  // AI mentions across the latest check of each site.
  const answers = runs.flatMap((r) => r?.results.filter((x) => !x.error) ?? []);
  const mentioned = answers.filter((a) => a.mentioned).length;
  const ci = wilson(mentioned, answers.length);
  const byEngine = ENGINES.map((e) => {
    const rs = answers.filter((a) => a.engine === e.id);
    return { ...e, connected: Boolean(process.env[e.envKey]), total: rs.length, rate: rs.length ? rs.filter((a) => a.mentioned).length / rs.length : null };
  });
  const firstSite = sites[0];

  const firstName = user.name.split(" ")[0];
  const headline =
    sites.length === 0
      ? "Let's audit your first website."
      : latestIds.length === 0
        ? "Your first audit is running."
        : totalHigh > 0
          ? `${plural(totalHigh, "urgent issue")} to fix.`
          : "Your sites look healthy.";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Status and add a site */}
        <section className="flex flex-col justify-between gap-8 rounded-[22px] bg-surface p-6 sm:p-7 xl:col-span-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-muted">Hi, {firstName}</p>
              <h1 className="mt-2 font-display text-3xl sm:text-[40px]">{headline}</h1>
              <p className="mt-2 max-w-md text-sm text-muted">
                Add a website and we check up to 50 pages for what stops you ranking in Google or getting recommended by AI.
              </p>
            </div>
            {avgHealth !== null && (
              <div className="flex items-center gap-3 sm:flex-col sm:items-center">
                <ScoreRing score={avgHealth} size={112} label="Average technical health" />
                <p className="text-xs text-muted">Average health</p>
              </div>
            )}
          </div>

          <div className="space-y-5">
            <AddDomainForm variant="dark" />
            <div className="grid grid-cols-3 gap-4 border-t border-line pt-5">
              <Readout label="Websites" value={sites.length} />
              <Readout label="Pages checked" value={totalPages} />
              <Readout label="Last audit" value={lastAudit ? lastAudit.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"} />
            </div>
          </div>
        </section>

        {/* AI visibility summary */}
        <section className="flex flex-col rounded-[22px] bg-surface p-6 xl:col-span-4">
          <SectionTitle
            hint={answers.length ? "Across the latest check of each site" : "How often AI assistants mention you"}
            action={
              firstSite && (
                <Link href={`/dashboard/visibility/${firstSite.id}`} aria-label="Open AI visibility" className="grid size-9 place-items-center rounded-full bg-panel text-muted transition-colors hover:bg-line hover:text-ink">
                  <ArrowUpRight className="size-4" />
                </Link>
              )
            }
          >
            AI visibility
          </SectionTitle>
          {answers.length ? (
            <div>
              <div className="flex items-baseline justify-between">
                <p className="font-display text-5xl">{pct(ci.rate)}</p>
                <p className="text-sm text-muted">{plural(answers.length, "answer")}</p>
              </div>
              <p className="mt-1 text-xs text-muted">
                of AI answers mention you · likely {pct(ci.low)}–{pct(ci.high)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">No AI checks yet. Add the questions your customers ask, then run a check.</p>
          )}
          <ul className="mt-auto space-y-3 pt-6">
            {byEngine.map((e) => (
              <li key={e.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5">
                <span className="flex items-center gap-2 text-sm">
                  <span className={`size-1.5 rounded-full ${e.connected ? "bg-ok" : "bg-muted/40"}`} />
                  {e.label}
                </span>
                <span className="text-xs tabular-nums text-muted">{e.rate === null ? (e.connected ? "Not checked" : "Not connected") : pct(e.rate)}</span>
                <Meter value={e.rate === null ? 0 : e.rate * 100} tone="ink" className="col-span-2 h-1" />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <SetupChecklist orgId={org.id} emailVerified={Boolean(user.emailVerifiedAt)} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* What to fix */}
        <Card className="xl:col-span-8">
          <SectionTitle hint="The most important open issues across your sites">Fix these first</SectionTitle>
          {urgent.length === 0 ? (
            <p className="rounded-2xl bg-panel p-5 text-sm text-muted">{sites.length ? "No urgent or medium issues across your sites." : "Run an audit to see what to fix."}</p>
          ) : (
            <ul className="-mx-2">
              {urgent.map((f) => (
                <li key={f.id}>
                  <Link href={`/dashboard/crawls/${f.crawlId}`} className="group flex items-center gap-4 rounded-2xl px-2 py-3 transition-colors hover:bg-panel">
                    <span className="w-[76px] shrink-0">
                      <SeverityBadge severity={f.severity} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{f.title}</p>
                      <p className="truncate text-xs text-muted">{f.crawl.domain.hostname}</p>
                    </div>
                    <LayerBadge layer={f.layer} />
                    <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Crawler access */}
        <Card className="xl:col-span-4">
          <SectionTitle hint={bots.length ? (blockedSites ? `${plural(blockedSites, "site")} blocking an AI search crawler` : "Every AI search crawler can read your sites") : "Shown after your first audit"}>
            Who can read you
          </SectionTitle>
          <ul className="space-y-1.5">
            {bots.map((b) => (
              <li key={b.engine} className="flex items-center justify-between gap-3 rounded-xl bg-panel px-3 py-2.5">
                <span className="truncate text-sm">{b.engine}</span>
                <span className={`flex items-center gap-1.5 text-xs ${b.blocked ? "text-high" : "text-ok"}`}>
                  <span className="size-1.5 rounded-full bg-current" />
                  {b.blocked ? `Blocked on ${b.blocked}` : "Allowed"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Websites */}
      <Card>
        <SectionTitle
          action={
            sites.length > 0 && (
              <Link href="/dashboard/sites" className="rounded-full bg-panel px-3 py-1.5 text-xs text-muted transition-colors hover:bg-line hover:text-ink">
                Manage
              </Link>
            )
          }
        >
          Websites
        </SectionTitle>
        {sites.length === 0 ? (
          <p className="rounded-2xl bg-panel p-5 text-sm text-muted">Your websites will show up here once you add one above.</p>
        ) : (
          <ul className="-mx-2">
            {sites.slice(0, 6).map((s) => (
              <li key={s.id}>
                <Link
                  href={s.latest ? `/dashboard/crawls/${s.latest.id}` : "/dashboard/sites"}
                  className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-2xl px-2 py-3 transition-colors hover:bg-panel sm:grid-cols-[auto_1.2fr_1fr_auto]"
                >
                  {s.score !== null ? <ScoreRing score={s.score} size={44} label={`${s.hostname} health`} /> : <span className="grid size-11 place-items-center"><StatusPill status={s.latest?.status ?? "queued"} /></span>}
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.hostname}</p>
                    <p className="text-xs text-muted">
                      {s.latest?.finishedAt
                        ? `${plural(s.latest.pagesCount, "page")} · audited ${s.latest.finishedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                        : "Audit in progress"}
                    </p>
                  </div>
                  <div className="hidden min-w-0 sm:block">
                    <p className={`text-xs ${s.high ? "text-high" : "text-muted"}`}>{s.high ? plural(s.high, "urgent issue") : "No urgent issues"}</p>
                    <Meter value={s.score ?? 0} className="mt-2" />
                  </div>
                  <ChevronRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
