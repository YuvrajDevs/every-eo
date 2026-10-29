import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { engineInfo } from "@/lib/engines";
import { factsToForm } from "@/lib/truth-form";
import { loadFacts } from "@/worker/truth";
import { Card, SectionTitle } from "@/components/ui";
import { FactsForm } from "@/components/facts-form";

const KINDS: { kind: string; title: string }[] = [
  { kind: "price_mismatch", title: "Wrong prices" },
  { kind: "discontinued_as_current", title: "Discontinued products shown as current" },
  { kind: "wrong_founding_year", title: "Wrong founding year" },
  { kind: "stolen_claim", title: "Your claims credited to others" },
];

export default async function TruthPage({ params }: { params: Promise<{ domainId: string }> }) {
  const { domainId } = await params;
  const { org } = await requireUser();
  const domain = await db.domain.findFirst({ where: { id: domainId, orgId: org.id }, include: { prompts: true } });
  if (!domain) notFound();
  const facts = await loadFacts(domain.id);
  const run = await db.visibilityRun.findFirst({ where: { domainId: domain.id, status: "completed" }, orderBy: { createdAt: "desc" }, include: { truthIssues: true, results: { select: { id: true, error: true } } } });
  const prompts = new Map(domain.prompts.map((p) => [p.id, p.text]));
  const answered = run?.results.filter((r) => !r.error).length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/dashboard/visibility/${domain.id}`} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> AI visibility
        </Link>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">What AI says about you</h1>
        <p className="mt-2 max-w-2xl text-xs text-muted">
          Checks the answers from your AI visibility runs against facts you give us: wrong prices, discontinued products presented as current, wrong dates, and your statistics credited to competitors. It reads answers already collected, so it costs nothing extra. It only flags what it can point to; read each sentence before acting.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1.3fr]">
        <Card>
          <SectionTitle>Your facts</SectionTitle>
          <FactsForm domainId={domain.id} values={factsToForm(facts)} />
        </Card>
        <Card>
          <SectionTitle>Findings</SectionTitle>
          {!run ? (
            <p className="text-sm text-muted">Run an AI visibility check first; findings come from its answers.</p>
          ) : !facts ? (
            <p className="text-sm text-muted">Add your facts to check the {answered} answers from the latest run.</p>
          ) : run.truthIssues.length === 0 ? (
            <div className="rounded-2xl bg-mint p-4">
              <p className="font-semibold">No contradictions found in {answered} answers.</p>
              <p className="mt-1 text-xs text-ink/70">From the run on {run.createdAt.toLocaleDateString()}.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-xs text-muted">From {answered} answers in the run on {run.createdAt.toLocaleDateString()}.</p>
              {KINDS.map(({ kind, title }) => {
                const items = run.truthIssues.filter((i) => i.kind === kind);
                if (!items.length) return null;
                return (
                  <div key={kind}>
                    <p className="font-semibold">
                      {title} <span className="text-muted">· {items.length}</span>
                    </p>
                    <ul className="mt-2 space-y-2">
                      {items.map((i) => (
                        <li key={i.id} className="rounded-2xl bg-panel p-3 text-sm">
                          <p className="text-[11px] text-muted">
                            {engineInfo(i.engine)?.label ?? i.engine} · “{prompts.get(i.promptId)?.slice(0, 80) ?? "deleted question"}”
                          </p>
                          <blockquote className="mt-1 border-l-2 border-line pl-3 italic">{i.sentence}</blockquote>
                          <p className="mt-1 text-xs">{i.detail}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              <p className="text-[11px] text-muted">
                To correct an engine: update the page it most likely read (often your pricing or about page) with clear, dated facts; make sure its search bot can reach you; and fix third-party listings (G2, Capterra, Wikipedia) that repeat the wrong detail.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
