import Link from "next/link";
import { AlertTriangle, Bot, FileSearch, Globe } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSites } from "@/lib/sites";
import { AddDomainForm } from "@/components/forms";
import { SiteCard } from "@/components/site-card";
import { SetupChecklist } from "@/components/setup-checklist";
import { Card, LayerBadge, SectionTitle, SeverityBadge, StatTile } from "@/components/ui";

export default async function DashboardPage() {
  const { user, org } = await requireUser();
  const sites = await getSites(org.id);
  const latestIds = sites.flatMap((s) => (s.latest?.status === "completed" ? [s.latest.id] : []));
  const urgent = await db.finding.findMany({
    where: { crawlId: { in: latestIds }, severity: { in: ["high", "medium"] } },
    include: { crawl: { select: { domain: { select: { hostname: true } } } } },
    take: 6,
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
  });

  const totalPages = sites.reduce((n, s) => n + (s.latest?.pagesCount ?? 0), 0);
  const totalHigh = sites.reduce((n, s) => n + s.high, 0);
  const totalBlocked = sites.reduce((n, s) => n + s.blockedSearchBots, 0);
  const firstName = user.name.split(" ")[0];

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-1 gap-4 rounded-[2rem] bg-dark p-6 text-on-dark sm:p-8 xl:grid-cols-[1fr_1.15fr]">
        <div className="flex flex-col justify-between gap-8">
          <div>
            <p className="text-sm text-on-dark/60">Hi, {firstName}</p>
            <h1 className="mt-3 font-display text-4xl sm:text-5xl">
              {sites.length === 0
                ? "Let's audit your first website."
                : latestIds.length === 0
                  ? "Your first audit is running."
                  : totalHigh > 0
                    ? `${totalHigh} urgent ${totalHigh === 1 ? "issue" : "issues"} to fix.`
                    : "Your sites look healthy."}
            </h1>
            <p className="mt-3 max-w-md text-on-dark/60">
              Enter a domain. We check up to 50 pages for what stops you ranking in Google or getting recommended by AI.
            </p>
          </div>
          <AddDomainForm variant="dark" />
        </div>

        {sites.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {sites.slice(0, 3).map((s, i) => (
              <SiteCard key={s.id} site={s} index={i} />
            ))}
          </div>
        ) : (
          <div className="hidden place-items-center rounded-3xl border border-dashed border-on-dark/20 p-8 text-center text-on-dark/50 xl:grid">
            Your websites will show up here.
          </div>
        )}
      </section>

      <SetupChecklist orgId={org.id} emailVerified={Boolean(user.emailVerifiedAt)} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Websites" value={sites.length} icon={Globe} />
        <StatTile label="Pages checked" value={totalPages} icon={FileSearch} />
        <StatTile label="Urgent issues" value={totalHigh} icon={AlertTriangle} tone={totalHigh ? "rose" : "white"} />
        <StatTile
          label="AI search bots blocked"
          value={totalBlocked}
          icon={Bot}
          tone={totalBlocked ? "rose" : "mint"}
          hint={totalBlocked ? "These engines can't cite you" : "Every AI engine can read you"}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <SectionTitle>Fix these first</SectionTitle>
          {urgent.length === 0 ? (
            <p className="text-muted">{sites.length ? "No urgent or medium issues across your sites." : "Run an audit to see what to fix."}</p>
          ) : (
            <ul className="divide-y divide-line">
              {urgent.map((f) => (
                <li key={f.id}>
                  <Link href={`/dashboard/crawls/${f.crawlId}`} className="flex items-start gap-4 py-3.5 transition hover:opacity-75">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{f.title}</p>
                      <p className="mt-0.5 truncate text-xs text-muted">{f.crawl.domain.hostname} · {f.url}</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <LayerBadge layer={f.layer} />
                      <SeverityBadge severity={f.severity} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle
            action={
              sites.length > 0 && (
                <Link href="/dashboard/sites" className="text-xs text-muted hover:text-ink">View all</Link>
              )
            }
          >
            Recent audits
          </SectionTitle>
          {sites.length === 0 ? (
            <p className="text-muted">Nothing yet.</p>
          ) : (
            <ul className="space-y-2">
              {sites.slice(0, 5).map((s) => (
                <li key={s.id}>
                  <Link
                    href={s.latest ? `/dashboard/crawls/${s.latest.id}` : "/dashboard/sites"}
                    className="flex items-center gap-3 rounded-2xl bg-panel p-3 transition hover:bg-line/60"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface">
                      <Globe className="size-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{s.hostname}</p>
                      <p className="text-[11px] text-muted">{s.latest?.createdAt.toLocaleDateString() ?? "—"}</p>
                    </div>
                    <span className="font-display text-xl">{s.score ?? "—"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
