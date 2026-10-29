import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleDashed, Info, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ENGINES, engineModel } from "@/lib/engines";
import { wilson, pct } from "@/lib/stats";
import { deletePrompt } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { AddPromptForm, BrandNameForm, RunCheckForm } from "@/components/visibility-forms";
import { Card, SectionTitle, StatusPill, TONES, type Tone } from "@/components/ui";

const ENGINE_TONES: Record<string, Tone> = { chatgpt: "mint", claude: "peach", gemini: "sky", perplexity: "lavender" };

type Cell = { mentioned: number; cited: number; total: number; errors: number };

function RateText({ cell }: { cell: Cell }) {
  if (cell.total === 0) return <span className="text-muted">{cell.errors ? "Failed" : "—"}</span>;
  const ci = wilson(cell.mentioned, cell.total);
  return (
    <span>
      <span className="font-semibold">{cell.mentioned}/{cell.total}</span>
      <span className="ml-1.5 text-[11px] text-muted">
        {pct(ci.low)}–{pct(ci.high)}
      </span>
    </span>
  );
}

export default async function DomainVisibilityPage({ params }: { params: Promise<{ domainId: string }> }) {
  const { domainId } = await params;
  const { org } = await requireUser();
  const domain = await db.domain.findFirst({
    where: { id: domainId, orgId: org.id },
    include: { prompts: { orderBy: { createdAt: "asc" } } },
  });
  if (!domain) notFound();

  const run = await db.visibilityRun.findFirst({
    where: { domainId: domain.id },
    orderBy: { createdAt: "desc" },
    include: { results: { orderBy: [{ trial: "asc" }] } },
  });
  const inProgress = run?.status === "queued" || run?.status === "running";
  const engines = ENGINES.map((e) => ({ ...e, connected: Boolean(process.env[e.envKey]), model: engineModel(e) }));
  const connected = engines.filter((e) => e.connected);
  const runEngines = run ? run.engines.split(",") : [];

  const cell = (filter: (r: NonNullable<typeof run>["results"][number]) => boolean): Cell => {
    const rs = run?.results.filter(filter) ?? [];
    const ok = rs.filter((r) => !r.error);
    return { mentioned: ok.filter((r) => r.mentioned).length, cited: ok.filter((r) => r.cited).length, total: ok.length, errors: rs.length - ok.length };
  };
  const overall = cell(() => true);
  const overallCi = wilson(overall.mentioned, overall.total);
  const expectedTotal = run ? domain.prompts.length * runEngines.length * run.trials : 0;
  // Which sites AI engines link to in answers where this brand isn't linked, and how many distinct questions each appears for.
  const root = domain.hostname.replace(/^www\./, "");
  const rivals = new Map<string, { answers: number; prompts: Set<string> }>();
  for (const r of run?.results ?? []) {
    if (r.error || r.cited || !r.citedUrls) continue;
    const hosts = new Set<string>();
    for (const c of JSON.parse(r.citedUrls) as { url: string }[]) {
      try {
        const h = new URL(c.url).hostname.replace(/^www\./, "");
        if (h !== root && !h.endsWith(`.${root}`)) hosts.add(h);
      } catch {}
    }
    for (const h of hosts) {
      const e = rivals.get(h) ?? { answers: 0, prompts: new Set<string>() };
      e.answers++;
      e.prompts.add(r.promptId);
      rivals.set(h, e);
    }
  }
  const topRivals = [...rivals].sort((a, b) => b[1].answers - a[1].answers).slice(0, 8);
  const firstError = run?.results.find((r) => r.error)?.error;

  return (
    <div className="space-y-6">
      {inProgress && <AutoRefresh everyMs={4000} />}

      <div>
        <Link href="/dashboard/visibility" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> AI visibility
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="truncate font-display text-4xl sm:text-5xl">{domain.hostname}</h1>
          {run && <StatusPill status={run.status} />}
        </div>
        <p className="mt-2 text-xs text-muted">
          {inProgress
            ? `Asking the AI engines… ${run.results.length} of ${expectedTotal} answers collected. This page updates on its own.`
            : run
              ? `Last checked ${run.createdAt.toLocaleString()} · estimated API cost $${(run.costMicros / 1_000_000).toFixed(2)}`
              : "Not checked yet."}
        </p>
      </div>

      {run && overall.total > 0 && (
        <section className="grid grid-cols-2 gap-3 xl:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="col-span-2 rounded-3xl bg-dark p-6 xl:col-span-1">
            <p className="text-xs text-ink/60">Mentioned across all answers</p>
            <p className="mt-2 font-display text-5xl">{pct(overallCi.rate)}</p>
            <p className="mt-2 text-xs text-ink/60">
              {overall.mentioned} of {overall.total} answers. The true rate is likely between {pct(overallCi.low)} and {pct(overallCi.high)}.
            </p>
          </div>
          {ENGINES.map((e) => {
            const c = cell((r) => r.engine === e.id);
            const ci = wilson(c.mentioned, c.total);
            const ran = runEngines.includes(e.id);
            return (
              <div key={e.id} className={`flex flex-col justify-between gap-4 rounded-3xl p-5 ${ran ? TONES[ENGINE_TONES[e.id]] : "bg-surface"}`}>
                <p className="text-sm font-semibold">{e.label}</p>
                {ran && c.total > 0 ? (
                  <div>
                    <p className="font-display text-4xl">{pct(ci.rate)}</p>
                    <p className="mt-1 text-[11px] text-ink/65">
                      likely {pct(ci.low)}–{pct(ci.high)} · linked {c.cited}×
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted">{ran ? "All calls failed" : "Not connected"}</p>
                )}
              </div>
            );
          })}
        </section>
      )}

      {run && run.status !== "queued" && firstError && overall.total === 0 && (
        <Card className="bg-rose">
          <p className="font-semibold">The engines returned errors</p>
          <p className="mt-1 break-words text-xs text-ink/75">{firstError}</p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <SectionTitle>Questions you&apos;re tracking</SectionTitle>
          <p className="-mt-2 mb-4 text-xs text-muted">
            Write them the way a customer would ask an AI assistant. Avoid putting your brand name in them.
          </p>
          <AddPromptForm domainId={domain.id} />

          {domain.prompts.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No questions yet.</p>
          ) : (
            <div className="-mx-2 mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="px-2 pb-2 font-normal">Question</th>
                    {run &&
                      ENGINES.filter((e) => runEngines.includes(e.id)).map((e) => (
                        <th key={e.id} className="px-2 pb-2 font-normal">{e.label}</th>
                      ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {domain.prompts.map((p) => (
                    <tr key={p.id} className="border-t border-line align-top">
                      <td className="px-2 py-3">{p.text}</td>
                      {run &&
                        ENGINES.filter((e) => runEngines.includes(e.id)).map((e) => (
                          <td key={e.id} className="whitespace-nowrap px-2 py-3">
                            <RateText cell={cell((r) => r.promptId === p.id && r.engine === e.id)} />
                          </td>
                        ))}
                      <td className="px-2 py-3">
                        <form action={deletePrompt.bind(null, p.id)}>
                          <button aria-label={`Stop tracking "${p.text}"`} title="Remove" className="text-muted hover:text-high">
                            <X className="size-4" />
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-6 border-t border-line pt-5">
            <RunCheckForm
              domainId={domain.id}
              promptCount={domain.prompts.length}
              engineCount={connected.length}
              disabled={inProgress || connected.length === 0 || domain.prompts.length === 0}
            />
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <SectionTitle>AI engines</SectionTitle>
            <ul className="space-y-2">
              {engines.map((e) => (
                <li key={e.id} className="flex items-center gap-3 rounded-2xl bg-panel px-4 py-3">
                  {e.connected ? <CheckCircle2 className="size-4 text-ok" /> : <CircleDashed className="size-4 text-muted" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{e.label}</p>
                    <p className="truncate text-[11px] text-muted">
                      {e.connected ? `${e.model} with web search` : `Add ${e.envKey} to .env to connect`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {topRivals.length > 0 && (
            <Card>
              <SectionTitle>Cited instead of you</SectionTitle>
              <p className="-mt-2 mb-3 text-xs text-muted">
                Sites AI engines linked in answers that didn&apos;t link you. These are where mentions and listings would be worth earning; many are third-party sites you can&apos;t outrank, only appear on.
              </p>
              <ul className="space-y-1.5">
                {topRivals.map(([host, v]) => (
                  <li key={host} className="flex items-center justify-between gap-3 rounded-xl bg-panel px-3 py-2 text-xs">
                    <span className="truncate">{host}</span>
                    <span className="shrink-0 text-muted">{v.answers} answers · {v.prompts.size} {v.prompts.size === 1 ? "question" : "questions"}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <SectionTitle>Your brand name</SectionTitle>
            <p className="-mt-2 mb-3 text-xs text-muted">
              We count an answer as a mention if it names this or your domain, or links to your site.
            </p>
            <BrandNameForm domainId={domain.id} brandName={domain.brandName} />
          </Card>

          <Card className="bg-panel">
            <div className="flex gap-3">
              <Info className="mt-0.5 size-4 shrink-0 text-muted" />
              <div className="space-y-2 text-xs text-muted">
                <p className="font-semibold text-ink">How to read these numbers</p>
                <p>AI answers change every time you ask, so we ask each question several times and report how often you were mentioned.</p>
                <p>
                  The range (for example 12–77%) is where the true rate most likely sits. Few repeats give a wide range; more repeats narrow it.
                </p>
                <p>We use each company&apos;s official API with web search on. Answers in their consumer apps can differ.</p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {run && run.results.some((r) => !r.error) && (
        <Card>
          <SectionTitle>What the AI engines said</SectionTitle>
          <div className="space-y-2">
            {domain.prompts.map((p) => {
              const answers = run.results.filter((r) => r.promptId === p.id && !r.error);
              if (answers.length === 0) return null;
              return (
                <details key={p.id} className="group rounded-2xl bg-panel">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                    <span className="font-semibold">{p.text}</span>
                    <span className="shrink-0 text-xs text-muted">{answers.length} answers</span>
                  </summary>
                  <ul className="space-y-3 px-4 pb-4">
                    {answers.map((a) => {
                      const urls: { url: string; title: string | null }[] = a.citedUrls ? JSON.parse(a.citedUrls) : [];
                      return (
                        <li key={a.id} className="rounded-xl bg-surface p-3">
                          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="rounded-full bg-panel px-2 py-0.5 font-semibold">{ENGINES.find((e) => e.id === a.engine)?.label}</span>
                            <span className="text-muted">try {a.trial}</span>
                            <span className={`rounded-full px-2 py-0.5 ${a.mentioned ? "bg-mint text-ok" : "bg-rose text-high"}`}>
                              {a.mentioned ? (a.cited ? "Mentioned + linked" : "Mentioned") : "Not mentioned"}
                            </span>
                          </div>
                          <p className="line-clamp-6 whitespace-pre-line text-xs leading-relaxed text-ink/85">{a.answer}</p>
                          {urls.length > 0 && (
                            <p className="mt-2 truncate text-[11px] text-muted">
                              Sources: {[...new Set(urls.map((u) => u.title || safeHost(u.url)))].slice(0, 6).join(" · ")}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
