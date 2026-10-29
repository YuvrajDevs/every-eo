import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowRight, Bot, FileSearch, Lock, MessageSquareQuote, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { healthScore } from "@/lib/health";
import type { BotAccessResult } from "@/lib/ai-bots";
import type { PublicAiResult } from "@/lib/public-audit";
import { AutoRefresh } from "@/components/auto-refresh";
import { PublicShell } from "@/components/public-shell";
import { Card, EvidenceBadge, LayerBadge, ScoreRing, SectionTitle, SeverityBadge, StatTile, buttonClass } from "@/components/ui";

// Results are about public websites but shouldn't show up in search engines.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const SEVERITY_ORDER = ["high", "medium", "low", "info"];
const TOP_N = 3;

export default async function PublicAuditResult({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const audit = await db.publicAudit.findUnique({
    where: { id },
    include: { crawl: { include: { findings: true, robots: true, pages: { select: { answerScore: true, wordCount: true, statusCode: true } } } } },
  });
  if (!audit) notFound();

  const { crawl } = audit;
  const crawling = crawl.status === "queued" || crawl.status === "running";
  const aiPending = audit.aiStatus === "queued" || audit.aiStatus === "running";
  const done = crawl.status === "completed";
  const signupHref = `/signup?site=${encodeURIComponent(audit.hostname)}`;

  const findings = crawl.findings
    .filter((f) => f.severity !== "info")
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const top = findings.slice(0, TOP_N);
  const hidden = findings.length - top.length;
  const bots: BotAccessResult[] = crawl.robots ? JSON.parse(crawl.robots.botAccess) : [];
  const searchBots = bots.filter((b) => b.purpose === "search");
  const blocked = bots.filter((b) => b.purpose !== "training" && (!b.allowed || b.reachable === false));
  const urgent = crawl.findings.filter((f) => f.severity === "high" && f.fixability !== "platform").length;
  const score = healthScore(crawl.findings);
  const content = crawl.pages.filter((p) => (p.statusCode ?? 0) < 400 && p.wordCount >= 200 && p.answerScore !== null);
  const answerAvg = content.length ? Math.round(content.reduce((n, p) => n + (p.answerScore ?? 0), 0) / content.length) : null;
  const ai: PublicAiResult | null = audit.aiResult ? JSON.parse(audit.aiResult) : null;

  return (
    <PublicShell>
      {(crawling || aiPending) && <AutoRefresh everyMs={3000} />}

      <div className="py-8 sm:py-12">
        <p className="text-sm text-muted">Free audit</p>
        <h1 className="mt-1 break-words font-display text-4xl sm:text-5xl">{audit.hostname}</h1>
        <p className="mt-2 text-sm text-muted">
          {crawling
            ? `Reading your site… ${crawl.pagesCount} pages so far. This page updates on its own.`
            : done
              ? `Checked ${crawl.pagesCount} pages${crawl.finishedAt ? ` on ${crawl.finishedAt.toLocaleDateString()}` : ""}.`
              : "We couldn't finish this audit."}
        </p>
      </div>

      {crawling && (
        <Card className="flex items-center gap-4">
          <span className="size-3 animate-pulse rounded-full bg-lavender" />
          <p>Checking which AI crawlers can read your site, then reading up to {crawl.maxPages} pages. Usually under a minute.</p>
        </Card>
      )}

      {crawl.status === "failed" && (
        <Card className="bg-rose">
          <p className="font-semibold">We couldn&apos;t read {audit.hostname}</p>
          <p className="mt-1 text-sm text-ink/75">
            The site didn&apos;t respond to us, or it blocks automated visitors. Check the address and{" "}
            <Link href={`/audit?site=${encodeURIComponent(audit.hostname)}`} className="underline underline-offset-4">try again</Link>.
          </p>
        </Card>
      )}

      {done && (
        <div className="space-y-6">
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div className="col-span-2 flex items-center gap-5 rounded-3xl bg-dark p-6 text-on-dark sm:col-span-3 xl:col-span-1">
              <ScoreRing score={score} size={92} />
              <div>
                <p className="font-display text-2xl">Technical health</p>
                <p className="mt-1 text-sm text-on-dark/65">
                  {urgent === 0 && blocked.length === 0
                    ? "Nothing is blocking search engines or AI from your site."
                    : `${urgent} urgent ${urgent === 1 ? "fix" : "fixes"} would raise this the most.`}
                </p>
              </div>
            </div>
            <StatTile label="Urgent issues" value={urgent} icon={AlertTriangle} tone={urgent ? "rose" : "mint"} />
            <StatTile
              label="AI crawlers blocked"
              value={blocked.length}
              icon={Bot}
              tone={blocked.length ? "rose" : "mint"}
              hint={blocked.length ? "These can't cite you" : "All can read you"}
            />
            <StatTile label="Answer readiness" value={answerAvg ?? "—"} icon={FileSearch} tone="lavender" hint="How quotable your pages are" />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
            <Card>
              <SectionTitle>Fix these first</SectionTitle>
              {top.length === 0 ? (
                <div className="rounded-2xl bg-mint p-5">
                  <p className="font-semibold">No significant issues found.</p>
                  <p className="mt-1 text-sm text-ink/70">Your site is in good technical shape for search engines and AI.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {top.map((f) => (
                    <li key={f.id} className="rounded-2xl bg-panel p-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SeverityBadge severity={f.severity} />
                        <LayerBadge layer={f.layer} />
                        <EvidenceBadge evidence={f.evidence} />
                      </div>
                      <p className="mt-2.5 font-semibold">{f.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{f.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-dashed border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-start gap-2 text-sm">
                  <Lock className="mt-0.5 size-4 shrink-0 text-muted" />
                  <span>
                    {hidden > 0 ? `${hidden} more ${hidden === 1 ? "issue" : "issues"}, ` : ""}
                    the page-by-page report, step-by-step fixes and AI tracking are in your free account.
                  </span>
                </p>
                <Link href={signupHref} className={`${buttonClass} shrink-0`}>
                  See full report <ArrowRight className="size-4" />
                </Link>
              </div>
            </Card>

            <div className="space-y-6">
              <Card>
                <SectionTitle>Can AI search read you?</SectionTitle>
                <ul className="space-y-1.5">
                  {searchBots.map((b) => {
                    const ok = b.allowed && b.reachable !== false;
                    return (
                      <li key={b.userAgent} className="flex items-center gap-3 rounded-xl bg-panel px-3 py-2">
                        <span className={`size-2 shrink-0 rounded-full ${ok ? "bg-ok" : "bg-high"}`} />
                        <span className="min-w-0 flex-1 truncate text-sm">{b.engine}</span>
                        <span className={`text-xs ${ok ? "text-ok" : "text-high"}`}>
                          {!b.allowed ? "Blocked" : b.reachable === false ? "Firewall blocks" : "Allowed"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>

              <AiCard audit={audit} ai={ai} pending={aiPending} />
            </div>
          </div>

          <section className="flex flex-col items-start justify-between gap-5 rounded-[2rem] bg-dark p-6 text-on-dark sm:flex-row sm:items-center sm:p-8">
            <div>
              <p className="flex items-center gap-2 font-display text-2xl">
                <Sparkles className="size-5" /> Get the full picture, free
              </p>
              <p className="mt-2 max-w-xl text-sm text-on-dark/65">
                Every issue on every page, fixes you can apply in a click on WordPress and Shopify, and tracking of how often
                ChatGPT, Claude, Gemini and Perplexity mention you.
              </p>
            </div>
            <Link href={signupHref} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-highlight px-6 py-3 font-medium text-on-highlight hover:opacity-85">
              Create free account <ArrowRight className="size-4" />
            </Link>
          </section>
        </div>
      )}
    </PublicShell>
  );
}

function AiCard({ audit, ai, pending }: { audit: { hostname: string; question: string | null; aiStatus: string }; ai: PublicAiResult | null; pending: boolean }) {
  if (!audit.question) {
    return (
      <Card className="bg-mint">
        <p className="flex items-center gap-2 font-display text-xl">
          <MessageSquareQuote className="size-5" /> Does AI mention you?
        </p>
        <p className="mt-2 text-sm text-ink/75">Run the free audit again with a question your customers ask, and we&apos;ll ask Gemini.</p>
        <Link href={`/audit?site=${encodeURIComponent(audit.hostname)}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-4">
          Add a question <ArrowRight className="size-3.5" />
        </Link>
      </Card>
    );
  }
  return (
    <Card>
      <SectionTitle>Does AI mention you?</SectionTitle>
      <p className="-mt-2 mb-3 text-sm text-muted">&ldquo;{audit.question}&rdquo;</p>
      {pending ? (
        <p className="flex items-center gap-3 text-sm">
          <span className="size-2.5 animate-pulse rounded-full bg-lavender" /> Asking Gemini 3 times…
        </p>
      ) : ai && typeof ai.total === "number" && ai.total > 0 ? (
        <>
          <p className="font-display text-4xl">
            {ai.mentioned} of {ai.total}
          </p>
          <p className="mt-1 text-sm text-muted">
            Gemini answers that mentioned {audit.hostname}.
            {ai.webSearch === false && " Gemini answered from its own knowledge, without web search."}
          </p>
          <details className="mt-3 rounded-2xl bg-panel">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">What Gemini said</summary>
            <ul className="space-y-2 px-4 pb-4">
              {ai.excerpts?.map((e, i) => (
                <li key={i} className="text-xs leading-relaxed text-ink/80">
                  <span className={`mr-2 rounded-full px-2 py-0.5 ${e.mentioned ? "bg-mint text-ok" : "bg-rose text-high"}`}>
                    {e.mentioned ? "Mentioned" : "Not mentioned"}
                  </span>
                  {e.text}
                  {e.text.length >= 600 ? "…" : ""}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <p className="text-sm text-muted">{ai?.reason ?? "The AI check didn't run this time."}</p>
      )}
    </Card>
  );
}
