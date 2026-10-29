import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { associate, beforeAfter, describe, MIN_WEEKS, SEARCH_SOURCES, weeklyClicks, weeklyMentionRate } from "@/lib/attribution";
import { Card, SectionTitle } from "@/components/ui";
import { WeekChart } from "@/components/week-chart";
import { SearchImportForm } from "@/components/search-import-form";

export default async function AttributionPage({ params }: { params: Promise<{ domainId: string }> }) {
  const { domainId } = await params;
  const { org } = await requireUser();
  const domain = await db.domain.findFirst({ where: { id: domainId, orgId: org.id } });
  if (!domain) notFound();

  const runs = await db.visibilityRun.findMany({ where: { domainId: domain.id, status: "completed" }, include: { results: { select: { mentioned: true, error: true } } } });
  const visibility = weeklyMentionRate(runs.map((r) => ({ createdAt: r.createdAt, mentioned: r.results.filter((x) => !x.error && x.mentioned).length, total: r.results.filter((x) => !x.error).length })));
  const days = await db.searchDay.findMany({ where: { domainId: domain.id }, orderBy: { date: "asc" } });
  const sources = [...new Set(days.map((d) => d.source))];
  const source = sources.includes("gsc_branded") ? "gsc_branded" : sources.includes("bing_branded") ? "bing_branded" : sources[0];
  const clicks = weeklyClicks(days.filter((d) => d.source === source));
  const allWeeks = [...new Set([...visibility.keys(), ...clicks.keys()])].sort();
  const associations = source ? [0, 1, 2].map((lag) => associate(visibility, clicks, lag)).filter((a) => a !== null) : [];
  const firstFix = await db.fix.findFirst({ where: { domainId: domain.id, appliedAt: { not: null } }, orderBy: { appliedAt: "asc" } });
  const ba = firstFix?.appliedAt && clicks.size ? beforeAfter(clicks, firstFix.appliedAt) : null;
  const overlap = allWeeks.filter((w) => visibility.has(w) && clicks.has(w)).length;
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/dashboard/visibility/${domain.id}`} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> AI visibility
        </Link>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">Does AI visibility move demand?</h1>
        <p className="mt-2 max-w-2xl text-xs text-muted">
          Compares how often AI answers mention you with how many people search for your brand on Google or Bing, week by week. Branded search is a better signal than analytics &quot;referrals&quot;, which label most AI-influenced visits as direct traffic. This shows association, not proof of cause.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card className="space-y-6">
          <SectionTitle>Week by week</SectionTitle>
          {allWeeks.length === 0 ? (
            <p className="text-sm text-muted">Run AI visibility checks over several weeks (a weekly schedule does this) and import your search data to see this.</p>
          ) : (
            <>
              <WeekChart title="AI answers that mention you" weeks={allWeeks} values={allWeeks.map((w) => visibility.get(w) ?? null)} format={pct} />
              <WeekChart
                title={source ? `Branded search clicks per week · ${SEARCH_SOURCES[source as keyof typeof SEARCH_SOURCES]}` : "Branded search clicks per week (import data)"}
                weeks={allWeeks}
                values={allWeeks.map((w) => clicks.get(w) ?? null)}
                format={(v) => Math.round(v).toLocaleString()}
              />
              <details className="text-xs">
                <summary className="cursor-pointer text-muted">Show as a table</summary>
                <table className="mt-2 w-full text-left">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 font-normal">Week of</th>
                      <th className="py-1 text-right font-normal">AI mention rate</th>
                      <th className="py-1 text-right font-normal">Branded clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allWeeks.map((w) => (
                      <tr key={w} className="border-t border-line">
                        <td className="py-1">{w}</td>
                        <td className="py-1 text-right tabular-nums">{visibility.has(w) ? pct(visibility.get(w)!) : "—"}</td>
                        <td className="py-1 text-right tabular-nums">{clicks.get(w)?.toLocaleString() ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </Card>
        <div className="space-y-6">
          <Card className="space-y-3 text-sm">
            <SectionTitle>What the data says</SectionTitle>
            {associations.length === 0 ? (
              <p className="text-muted">
                Needs at least {MIN_WEEKS} weeks with both an AI check and complete search data; you have {overlap}. Weekly scheduled checks build this up automatically.
              </p>
            ) : (
              associations.map((a) => <p key={a.lagWeeks}>{describe(a)}</p>)
            )}
            {ba && (
              <p>
                Since your first fix went live ({firstFix!.appliedAt!.toLocaleDateString()}): branded clicks averaged {Math.round(ba.after).toLocaleString()} a week, versus {Math.round(ba.before).toLocaleString()} in the 4 weeks before
                {ba.change !== null ? ` (${ba.change >= 0 ? "+" : ""}${Math.round(ba.change * 100)}%)` : ""}. Seasonality and campaigns can explain changes like this too.
              </p>
            )}
          </Card>
          <Card>
            <SectionTitle>Import search data</SectionTitle>
            <p className="-mt-2 mb-3 text-xs text-muted">
              Google: Search Console → Performance → add a Query filter containing your brand name → Export → use Dates.csv. Bing: Webmaster Tools → Search Performance → export with a branded keyword filter. Re-importing a report replaces it.
            </p>
            <SearchImportForm domainId={domain.id} sources={SEARCH_SOURCES} />
            {sources.length > 0 && <p className="mt-3 text-[11px] text-muted">Imported: {sources.map((s) => SEARCH_SOURCES[s as keyof typeof SEARCH_SOURCES]).join("; ")}</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
