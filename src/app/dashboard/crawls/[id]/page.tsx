import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Bot, CircleAlert, FileSearch, Gauge, RotateCw } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { healthScore } from "@/lib/health";
import type { BotAccessResult, BotPurpose } from "@/lib/ai-bots";
import type { PerformanceReport } from "@/worker/performance";
import { recrawl } from "@/app/actions";
import { PLATFORM_LABELS, type PlatformId } from "@/lib/platforms";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, EvidenceBadge, LayerBadge, ScoreRing, SectionTitle, SeverityBadge, StatTile, StatusPill } from "@/components/ui";

const SEVERITY_ORDER = ["high", "medium", "low", "info"];
const LAYERS = [
  { key: "all", label: "All" },
  { key: "seo", label: "SEO · Google" },
  { key: "aeo", label: "AEO · AI Overviews" },
  { key: "geo", label: "GEO · ChatGPT & co" },
];
const PURPOSE_GROUPS: { purpose: BotPurpose; label: string; note: string }[] = [
  { purpose: "search", label: "Search & citations", note: "Must be allowed to appear in answers" },
  { purpose: "user-fetch", label: "Live fetch for a user", note: "Visits when someone asks about you" },
  { purpose: "training", label: "Model training", note: "Your choice — doesn't affect citations" },
];

export default async function CrawlPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ layer?: string }>;
}) {
  const [{ id }, { layer = "all" }] = await Promise.all([params, searchParams]);
  const { org } = await requireUser();
  const crawl = await db.crawl.findFirst({
    where: { id, orgId: org.id },
    include: { domain: true, robots: true, findings: true, pages: { orderBy: { url: "asc" } } },
  });
  if (!crawl) notFound();

  const inProgress = crawl.status === "queued" || crawl.status === "running";
  const done = crawl.status === "completed";
  const bots: BotAccessResult[] = crawl.robots ? JSON.parse(crawl.robots.botAccess) : [];
  const allFindings = [...crawl.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const findings = layer === "all" ? allFindings : allFindings.filter((f) => f.layer === layer);
  const count = (s: string) => allFindings.filter((f) => f.severity === s).length;
  const blockedSearch = bots.filter((b) => !b.allowed && b.purpose !== "training").length;
  const score = healthScore(allFindings);
  const brokenPages = crawl.pages.filter((p) => (p.statusCode ?? 0) >= 400).length;
  const perf: PerformanceReport | null = crawl.performance ? JSON.parse(crawl.performance) : null;
  const scored = crawl.pages.filter((p) => p.answerScore !== null && p.wordCount >= 200);
  const answerAvg = scored.length ? Math.round(scored.reduce((n, p) => n + (p.answerScore ?? 0), 0) / scored.length) : null;

  return (
    <div className="space-y-6">
      {inProgress && <AutoRefresh />}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href="/dashboard/sites" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink">
            <ArrowLeft className="size-3.5" /> Websites
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="truncate font-display text-4xl sm:text-5xl">{crawl.domain.hostname}</h1>
            <StatusPill status={crawl.status} />
            {crawl.platform && crawl.platform !== "unknown" && (
              <span className="rounded-full bg-panel px-3 py-1 text-xs">Built with {PLATFORM_LABELS[crawl.platform as PlatformId] ?? crawl.platform}</span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">
            {inProgress
              ? `Reading your site… ${crawl.pagesCount} pages so far. This page updates on its own.`
              : `Audited ${crawl.createdAt.toLocaleString()}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {done && (
            <Link href={`/dashboard/entity/${crawl.domainId}`} className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-4 py-2.5 text-xs hover:border-ink">
              Brand profile
            </Link>
          )}
          {done && (
            <Link href={`/dashboard/crawls/${id}/report`} className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-4 py-2.5 text-xs hover:border-ink">
              Report
            </Link>
          )}
          {!inProgress && (
            <form action={recrawl.bind(null, crawl.domainId)}>
              <button className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-4 py-2.5 text-xs hover:border-ink">
                <RotateCw className="size-3.5" /> Run again
              </button>
            </form>
          )}
        </div>
      </div>

      {crawl.error && (
        <Card className="flex items-start gap-3 bg-rose">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-high" />
          <p>The audit couldn&apos;t finish: {crawl.error}</p>
        </Card>
      )}

      {inProgress && (
        <Card className="flex items-center gap-4">
          <span className="size-3 animate-pulse rounded-full bg-lavender" />
          <p>Checking robots.txt, then reading up to {crawl.maxPages} pages. Usually under a minute.</p>
        </Card>
      )}

      {done && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div className="flex items-center gap-5 rounded-3xl bg-dark p-6 text-ink col-span-2 sm:col-span-3 xl:col-span-1">
            <div className="text-ink">
              <ScoreRing score={score} size={88} />
            </div>
            <div>
              <p className="font-display text-2xl">Technical health</p>
              <p className="mt-1 text-xs text-white/60">
                {count("high") === 0 && blockedSearch === 0
                  ? "Nothing is blocking search engines or AI from your site."
                  : `${count("high")} urgent ${count("high") === 1 ? "fix" : "fixes"} will raise this the most.`}
              </p>
            </div>
          </div>
          <StatTile label="Urgent issues" value={count("high")} icon={AlertTriangle} tone={count("high") ? "rose" : "mint"} />
          <StatTile
            label="AI search bots blocked"
            value={blockedSearch}
            icon={Bot}
            tone={blockedSearch ? "rose" : "mint"}
            hint={blockedSearch ? "Can't cite you" : "All can read you"}
          />
          <StatTile label="Pages checked" value={crawl.pagesCount} icon={FileSearch} tone="lavender" hint={brokenPages ? `${brokenPages} broken` : "None broken"} />
        </section>
      )}

      {done && (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Card className="md:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-display text-xl">Homepage speed on mobile</p>
                <p className="mt-1 text-xs text-muted">From Google PageSpeed Insights{perf?.field ? ", including real-visitor data" : ""}.</p>
              </div>
              <Gauge className="size-5 text-muted" strokeWidth={1.5} />
            </div>
            {!perf || perf.error ? (
              <p className="mt-4 rounded-2xl bg-panel p-4 text-xs text-muted">
                Couldn&apos;t measure speed this time{perf?.error?.includes("Quota") ? ": Google's free daily limit was reached. Add a free PSI_API_KEY to .env to remove the limit." : perf?.error ? `: ${perf.error}` : "."}
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Lab score" value={perf.score !== null ? `${perf.score}` : "—"} good={(perf.score ?? 0) >= 90} poor={(perf.score ?? 100) < 50} />
                <Metric label="Main content shows" value={perf.lcpMs !== null ? `${(perf.lcpMs / 1000).toFixed(1)}s` : "—"} good={(perf.lcpMs ?? 9e9) <= 2500} poor={(perf.lcpMs ?? 0) > 4000} />
                <Metric label="Layout shift" value={perf.cls !== null ? perf.cls.toFixed(2) : "—"} good={(perf.cls ?? 9) <= 0.1} poor={(perf.cls ?? 0) > 0.25} />
                <Metric
                  label="Real visitors"
                  value={perf.field?.category ? perf.field.category.toLowerCase() : "no data"}
                  good={perf.field?.category === "FAST"}
                  poor={perf.field?.category === "SLOW"}
                />
              </div>
            )}
          </Card>
          <Card className="flex flex-col justify-between gap-4">
            <div>
              <p className="font-display text-xl">Answer readiness</p>
              <p className="mt-1 text-xs text-muted">How easy your content pages are for AI to quote. Beta heuristic.</p>
            </div>
            <div className="flex items-end justify-between gap-3">
              <p className={`font-display text-5xl ${answerAvg === null ? "text-muted" : answerAvg >= 70 ? "text-ok" : answerAvg >= 40 ? "text-medium" : "text-high"}`}>
                {answerAvg ?? "—"}
              </p>
              <Link href={`/dashboard/visibility/${crawl.domainId}`} className="inline-flex items-center gap-1 rounded-full bg-highlight px-3 py-1.5 text-xs font-medium text-on-highlight hover:opacity-85">
                Check AI answers <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
          </Card>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
        {done && (
          <Card>
            <SectionTitle>What to fix</SectionTitle>
            <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
              {LAYERS.map((l) => {
                const n = l.key === "all" ? allFindings.length : allFindings.filter((f) => f.layer === l.key).length;
                const active = layer === l.key;
                return (
                  <Link
                    key={l.key}
                    href={l.key === "all" ? `/dashboard/crawls/${id}` : `/dashboard/crawls/${id}?layer=${l.key}`}
                    scroll={false}
                    className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs transition ${
                      active ? "bg-ink text-accent-ink" : "bg-panel text-ink hover:bg-line"
                    }`}
                  >
                    {l.label}
                    <span className={`rounded-full px-1.5 text-[10px] ${active ? "bg-accent-ink/15" : "bg-surface"}`}>{n}</span>
                  </Link>
                );
              })}
            </div>

            {findings.length === 0 ? (
              <div className="rounded-2xl bg-mint p-5">
                <p className="font-semibold">Nothing to fix here.</p>
                <p className="mt-1 text-xs text-ink/70">No issues found in this category on this run.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {findings.map((f) => (
                  <li key={f.id} className="rounded-2xl bg-panel p-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SeverityBadge severity={f.severity} />
                      <LayerBadge layer={f.layer} />
                      <EvidenceBadge evidence={f.evidence} />
                      {f.fixability === "platform" && (
                        <span title="Your site builder controls this; it doesn't count against your score" className="rounded-full bg-panel px-2.5 py-0.5 text-[11px] text-muted">
                          Controlled by your platform
                        </span>
                      )}
                    </div>
                    <p className="mt-2.5 font-semibold">{f.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{f.detail}</p>
                    {f.howTo && (
                      <p className="mt-2 rounded-xl bg-surface px-3 py-2 text-xs leading-relaxed">
                        <span className="font-semibold">How to fix on {PLATFORM_LABELS[crawl.platform as PlatformId] ?? "your platform"}: </span>
                        {f.howTo}
                      </p>
                    )}
                    {f.url && (
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="mt-2 block truncate text-[11px] text-ink/60 underline-offset-4 hover:underline">
                        {f.url}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {crawl.robots && (
          <Card className="h-fit">
            <SectionTitle>Who can read your site</SectionTitle>
            <p className="-mt-2 mb-4 text-xs text-muted">
              From {crawl.robots.found ? "your robots.txt file" : "no robots.txt file, so everything is allowed"}.
            </p>
            <div className="space-y-5">
              {PURPOSE_GROUPS.map((g) => (
                <div key={g.purpose}>
                  <p className="text-xs font-semibold">{g.label}</p>
                  <p className="mb-2 text-[11px] text-muted">{g.note}</p>
                  <ul className="space-y-1">
                    {bots
                      .filter((b) => b.purpose === g.purpose)
                      .map((b) => (
                        <li key={b.userAgent} className="flex items-center gap-3 rounded-xl bg-panel px-3 py-2">
                          <span
                            className={`size-2 shrink-0 rounded-full ${
                              b.allowed && b.reachable !== false ? "bg-ok" : g.purpose === "training" ? "bg-muted" : "bg-high"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs">{b.engine}</p>
                            <p className="truncate text-[10px] text-muted">{b.userAgent}</p>
                          </div>
                          <span
                            title={b.reachable === false ? `robots.txt allows it, but a live request got ${b.reachStatus ?? "no response"}` : undefined}
                            className={`text-right text-[11px] ${b.allowed && b.reachable !== false ? "text-ok" : g.purpose === "training" ? "text-muted" : "text-high"}`}
                          >
                            {!b.allowed ? "Blocked" : b.reachable === false ? "Firewall blocks" : b.reachable ? "Allowed · tested" : "Allowed"}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {crawl.pages.length > 0 && (
        <Card>
          <SectionTitle>Pages checked</SectionTitle>
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="px-2 pb-3 font-normal">Page</th>
                  <th className="px-2 pb-3 font-normal">Status</th>
                  <th className="px-2 pb-3 font-normal">Title</th>
                  <th className="px-2 pb-3 text-right font-normal">Words</th>
                  <th className="px-2 pb-3 text-right font-normal" title="How easy the page is for AI to quote (beta heuristic)">Answer-ready</th>
                  <th className="px-2 pb-3 font-normal">Schema</th>
                </tr>
              </thead>
              <tbody>
                {crawl.pages.map((p) => {
                  const ok = (p.statusCode ?? 0) < 400;
                  return (
                    <tr key={p.id} className="border-t border-line align-top">
                      <td className="max-w-[240px] truncate px-2 py-3">{new URL(p.url).pathname}</td>
                      <td className="px-2 py-3">
                        <span className={`rounded-full px-2 py-0.5 ${ok ? "bg-mint text-ok" : "bg-rose text-high"}`}>{p.statusCode}</span>
                      </td>
                      <td className="max-w-[280px] truncate px-2 py-3">{p.title ?? <span className="text-high">Missing</span>}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{p.wordCount}</td>
                      <td className="px-2 py-3 text-right tabular-nums">
                        {p.answerScore === null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span className={p.answerScore >= 70 ? "text-ok" : p.answerScore >= 40 ? "text-medium" : "text-high"}>{p.answerScore}</span>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap gap-1">
                          {p.jsonLdTypes ? (
                            p.jsonLdTypes.split(",").map((t) => (
                              <span key={t} className="rounded-full bg-panel px-2 py-0.5 text-[10px]">{t}</span>
                            ))
                          ) : (
                            <span className="text-muted">None</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value, good, poor }: { label: string; value: string; good: boolean; poor: boolean }) {
  return (
    <div className="rounded-2xl bg-panel p-3">
      <p className={`font-display text-2xl capitalize ${good ? "text-ok" : poor ? "text-high" : "text-medium"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-muted">{label}</p>
    </div>
  );
}
