import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pct } from "@/lib/stats";
import { entitiesFor, leadersByPrompt, shareOfVoice, trend } from "@/lib/share-of-voice";
import { toneSummary } from "@/lib/sentiment";
import { brandTerms } from "@/worker/visibility/run";
import { loadFacts } from "@/worker/truth";
import { Card, SectionTitle } from "@/components/ui";

const RECENT_RUNS = 8;

export default async function CompetitorsPage({ params }: { params: Promise<{ domainId: string }> }) {
  const { domainId } = await params;
  const { org } = await requireUser();
  const domain = await db.domain.findFirst({ where: { id: domainId, orgId: org.id }, include: { prompts: true } });
  if (!domain) notFound();
  const facts = await loadFacts(domain.id);
  const competitors = facts?.competitors ?? [];
  const runs = await db.visibilityRun.findMany({ where: { domainId: domain.id, status: "completed" }, orderBy: { createdAt: "desc" }, take: RECENT_RUNS, include: { results: true } });
  const answers = runs.flatMap((r) => r.results.map((x) => ({ ...x, createdAt: r.createdAt })));
  const latest = runs.find((r) => r.results.some((x) => !x.error));
  const latestAnswers = latest ? latest.results.map((x) => ({ ...x, createdAt: latest.createdAt })) : [];
  const terms = brandTerms(domain.hostname, domain.brandName);
  const entities = entitiesFor(domain.brandName || domain.hostname, terms, competitors);
  const sov = shareOfVoice(latestAnswers, entities);
  const leaders = leadersByPrompt(latestAnswers, entities);
  const history = trend(answers, entities);
  const tone = toneSummary(latestAnswers, terms);
  const prompts = new Map(domain.prompts.map((p) => [p.id, p.text]));

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/dashboard/visibility/${domain.id}`} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> AI visibility
        </Link>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">You vs competitors</h1>
        <p className="mt-2 max-w-2xl text-xs text-muted">
          From the answers AI engines gave to your tracked questions. Uses answers already collected, so it costs nothing extra.
          {competitors.length === 0 && (
            <>
              {" "}
              Add competitors on the{" "}
              <Link href={`/dashboard/truth/${domain.id}`} className="underline underline-offset-4">
                accuracy page
              </Link>{" "}
              to compare.
            </>
          )}
        </p>
      </div>

      {!latest ? (
        <Card>
          <p className="text-sm text-muted">Run an AI visibility check first.</p>
        </Card>
      ) : (
        <>
          <Card>
            <SectionTitle>Share of voice · latest check</SectionTitle>
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="px-2 pb-2 font-normal">Brand</th>
                    <th className="px-2 pb-2 text-right font-normal">Share of all mentions</th>
                    <th className="px-2 pb-2 text-right font-normal">Mentioned in</th>
                  </tr>
                </thead>
                <tbody>
                  {sov.map((r) => (
                    <tr key={r.name} className={`border-t border-line ${r.isYou ? "font-semibold" : ""}`}>
                      <td className="px-2 py-2.5">
                        {r.name}
                        {r.isYou && <span className="ml-2 rounded-full bg-highlight px-2 py-0.5 text-[10px] text-on-highlight">you</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{pct(r.share)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {pct(r.mentionRate)} <span className="text-[11px] font-normal text-muted">({pct(r.low)}–{pct(r.high)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card>
              <SectionTitle>Who owns each question</SectionTitle>
              <ul className="space-y-2 text-sm">
                {leaders.map((l) => (
                  <li key={l.promptId} className="rounded-2xl bg-panel p-3">
                    <p>{prompts.get(l.promptId) ?? "Deleted question"}</p>
                    <p className="mt-1 text-xs text-muted">
                      {l.leader ? `Named most: ${l.leader}` : "No tracked brand named"} ·{" "}
                      {l.rates
                        .filter((r) => r.rate > 0)
                        .map((r) => `${r.name} ${pct(r.rate)}`)
                        .join(", ") || "—"}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <SectionTitle>Tone when AI mentions you</SectionTitle>
              {tone.mentions === 0 ? (
                <p className="text-sm text-muted">No answers in the latest check mention you.</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {(["positive", "neutral", "negative"] as const).map((t) => (
                      <div key={t} className={`rounded-2xl p-3 ${t === "positive" ? "bg-mint" : t === "negative" ? "bg-rose" : "bg-panel"}`}>
                        <p className="font-display text-3xl">{tone[t]}</p>
                        <p className="text-xs capitalize">{t}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-muted">Out of {tone.mentions} answers that mention you. Word-based heuristic; read the examples before acting.</p>
                  {tone.negativeExamples.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-xs font-semibold">Negative mentions</p>
                      {tone.negativeExamples.map((e) => (
                        <blockquote key={e} className="border-l-2 border-high pl-3 text-xs italic">
                          {e}
                        </blockquote>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>

          {history.length > 1 && (
            <Card>
              <SectionTitle>Mention rate over recent checks</SectionTitle>
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="px-2 pb-2 font-normal">Check</th>
                      {entities.map((e) => (
                        <th key={e.name} className="px-2 pb-2 text-right font-normal">
                          {e.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.at.toISOString()} className="border-t border-line">
                        <td className="px-2 py-2">{h.at.toLocaleDateString()}</td>
                        {entities.map((e) => (
                          <td key={e.name} className="px-2 py-2 text-right tabular-nums">
                            {pct(h.rates[e.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
