import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { healthScore } from "@/lib/health";
import { engineInfo } from "@/lib/engines";
import { pct, wilson } from "@/lib/stats";
import { PrintButton } from "@/components/print-button";
import { PLATFORM_LABELS, type PlatformId } from "@/lib/platforms";
import { brandFor } from "@/lib/branding";

const GRADES = [
  { key: "proven", label: "Proven", note: "Backed by platform documentation or consistent evidence. Fix these first." },
  { key: "plausible", label: "Plausible", note: "Widely recommended and logical, but not independently confirmed to move AI citations." },
  { key: "speculative", label: "Speculative", note: "Contested or near-zero measured effect. Low priority; do not expect results." },
];
const SEVERITY = ["high", "medium", "low", "info"];

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, agency } = await requireUser();
  const brand = brandFor(org, agency);
  const crawl = await db.crawl.findFirst({ where: { id, orgId: org.id }, include: { domain: true, findings: true } });
  if (!crawl || crawl.status !== "completed") notFound();

  const run = await db.visibilityRun.findFirst({
    where: { domainId: crawl.domainId, status: "completed" },
    orderBy: { createdAt: "desc" },
    include: { results: true },
  });
  const byEngine = new Map<string, { n: number; mentioned: number; cited: number }>();
  for (const r of run?.results.filter((x) => !x.error) ?? []) {
    const e = byEngine.get(r.engine) ?? { n: 0, mentioned: 0, cited: 0 };
    e.n++;
    if (r.mentioned) e.mentioned++;
    if (r.cited) e.cited++;
    byEngine.set(r.engine, e);
  }
  const score = healthScore(crawl.findings);

  return (
    <article className="mx-auto max-w-3xl space-y-8 print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/dashboard/crawls/${id}`} className="text-xs text-muted hover:text-ink">← Back to audit</Link>
        <PrintButton />
      </div>

      <header>
        <div className="mb-4 flex items-center gap-3">
          {brand.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- agency logos are arbitrary external URLs
            <img src={brand.logoUrl} alt="" width={40} height={40} referrerPolicy="no-referrer" className="size-10 object-contain" />
          )}
          <p className="font-display text-xl">{brand.name}</p>
        </div>
        <p className="text-xs text-muted">Visibility audit · {crawl.createdAt.toLocaleDateString()}</p>
        <h1 className="mt-1 font-display text-5xl">{crawl.domain.hostname}</h1>
        <p className="mt-3 text-sm">
          Technical health <strong>{score}/100</strong> across {crawl.pagesCount} pages, with {crawl.findings.length} findings.
          {crawl.platform && crawl.platform !== "unknown" && ` Built with ${PLATFORM_LABELS[crawl.platform as PlatformId] ?? crawl.platform}; issues your platform controls are marked and don't count against the score.`}
        </p>
      </header>

      <section>
        <h2 className="font-display text-2xl">AI answer visibility</h2>
        {byEngine.size === 0 ? (
          <p className="mt-2 text-sm text-muted">No completed AI answer check yet. Run one from the Visibility page to add it here.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">
              Share of sampled answers that mention the brand, with a 95% range. AI answers vary run to run, so these are estimates, not exact scores.
            </p>
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr><th className="pb-2 font-normal">Engine</th><th className="pb-2 font-normal">Answers</th><th className="pb-2 font-normal">Mentioned</th><th className="pb-2 font-normal">Cited</th></tr>
              </thead>
              <tbody>
                {[...byEngine].map(([engine, e]) => {
                  const m = wilson(e.mentioned, e.n);
                  const c = wilson(e.cited, e.n);
                  return (
                    <tr key={engine} className="border-t border-line">
                      <td className="py-2">{engineInfo(engine)?.label ?? engine}</td>
                      <td className="py-2 tabular-nums">{e.n}</td>
                      <td className="py-2 tabular-nums">{pct(m.rate)} <span className="text-xs text-muted">({pct(m.low)}–{pct(m.high)})</span></td>
                      <td className="py-2 tabular-nums">{pct(c.rate)} <span className="text-xs text-muted">({pct(c.low)}–{pct(c.high)})</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>

      {GRADES.map((g) => {
        const items = crawl.findings.filter((f) => f.evidence === g.key).sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity));
        if (items.length === 0) return null;
        return (
          <section key={g.key} className="break-inside-avoid-page">
            <h2 className="font-display text-2xl">{g.label} <span className="text-base text-muted">· {items.length}</span></h2>
            <p className="mt-1 text-xs text-muted">{g.note}</p>
            <ul className="mt-3 space-y-3">
              {items.map((f) => (
                <li key={f.id} className="break-inside-avoid border-t border-line pt-3">
                  <p className="text-xs uppercase tracking-wide text-muted">{f.severity} · {f.layer}</p>
                  <p className="font-semibold">{f.title}</p>
                  <p className="mt-1 text-sm text-muted">{f.detail}</p>
                  {f.howTo && <p className="mt-1 text-sm"><strong>How to fix:</strong> {f.howTo}</p>}
                  {f.fixability === "platform" && <p className="mt-1 text-xs text-muted">Controlled by your platform — not counted in the score.</p>}
                  {f.url && <p className="mt-1 truncate text-xs text-muted">{f.url}</p>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <footer className="space-y-2 border-t border-line pt-4 text-xs text-muted">
        {brand.reportFooter && <p className="text-ink">{brand.reportFooter}</p>}
        <p>Evidence grades reflect published research and platform documentation. Answer readiness is a beta heuristic. No AI vendor publishes ranking data, so visibility figures are sampled estimates.</p>
      </footer>
    </article>
  );
}
