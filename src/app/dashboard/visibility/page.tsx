import Link from "next/link";
import { ArrowUpRight, Radar } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { wilson, pct } from "@/lib/stats";
import { toneFor } from "@/components/site-card";
import { Card, TONES } from "@/components/ui";

export default async function VisibilityIndexPage() {
  const { org } = await requireUser();
  const domains = await db.domain.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { prompts: true } },
      visibilityRuns: {
        where: { status: "completed" },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { results: { select: { mentioned: true, error: true } } },
      },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl sm:text-5xl">AI visibility</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Ask ChatGPT, Claude, Gemini and Perplexity the questions your customers ask, and see how often they mention you.
        </p>
      </div>

      {domains.length === 0 ? (
        <Card className="text-muted">
          Add a website first from the <Link href="/dashboard" className="text-ink underline underline-offset-4">dashboard</Link>.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {domains.map((d, i) => {
            const results = d.visibilityRuns[0]?.results.filter((r) => !r.error) ?? [];
            const mentions = results.filter((r) => r.mentioned).length;
            const ci = wilson(mentions, results.length);
            return (
              <Link
                key={d.id}
                href={`/dashboard/visibility/${d.id}`}
                className={`group flex min-h-[180px] flex-col justify-between rounded-3xl p-5 transition hover:-translate-y-0.5 ${TONES[toneFor(i)]}`}
              >
                <div className="flex items-start justify-between">
                  <Radar className="size-5" strokeWidth={1.5} />
                  <ArrowUpRight className="size-4 opacity-50 group-hover:opacity-100" />
                </div>
                <div>
                  <p className="truncate font-display text-xl">{d.hostname}</p>
                  <p className="mt-1 text-xs text-ink/70">
                    {results.length > 0
                      ? `Mentioned in ${pct(ci.rate)} of answers (likely ${pct(ci.low)}–${pct(ci.high)})`
                      : d._count.prompts > 0
                        ? `${d._count.prompts} questions ready · not checked yet`
                        : "No questions yet"}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
