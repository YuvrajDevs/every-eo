import Link from "next/link";
import { ChevronRight, RotateCw } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getSites } from "@/lib/sites";
import { recrawl } from "@/app/actions";
import { AddDomainForm } from "@/components/forms";
import { Card, Meter, PageHeader, ScoreRing, StatusPill } from "@/components/ui";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function SitesPage() {
  const { org } = await requireUser();
  const sites = await getSites(org.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Websites"
        context="Every site in your workspace, with its latest audit."
        actions={
          <div className="w-full sm:w-[420px]">
            <AddDomainForm />
          </div>
        }
      />

      {sites.length === 0 ? (
        <Card className="text-center text-sm text-muted">No websites yet. Add your first one above.</Card>
      ) : (
        <Card className="p-2 sm:p-3">
          <div className="hidden grid-cols-[52px_1.4fr_1fr_1fr_88px] gap-4 px-3 pb-2 pt-1 text-xs text-muted sm:grid">
            <span>Health</span>
            <span>Website</span>
            <span>Issues</span>
            <span>Score</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul>
            {sites.map((s) => {
              const href = s.latest ? `/dashboard/crawls/${s.latest.id}` : null;
              const row = (
                <>
                  <span className="grid w-[52px] place-items-center">
                    {s.score !== null ? <ScoreRing score={s.score} size={44} label={`${s.hostname} health`} /> : <StatusPill status={s.latest?.status ?? "queued"} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.hostname}</span>
                    <span className="block text-xs text-muted">
                      {s.latest?.finishedAt
                        ? `${plural(s.latest.pagesCount, "page")} · audited ${s.latest.finishedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                        : s.latest
                          ? "Audit in progress"
                          : "Not audited yet"}
                    </span>
                  </span>
                  <span className="hidden text-sm sm:block">
                    <span className={s.high ? "text-high" : "text-muted"}>{s.high} urgent</span>
                    <span className="text-muted"> · {s.medium} medium</span>
                  </span>
                  <span className="hidden sm:block">
                    <Meter value={s.score ?? 0} />
                  </span>
                </>
              );
              return (
                <li key={s.id} className="group grid grid-cols-[1fr_auto] items-center gap-2 rounded-2xl transition-colors hover:bg-panel sm:grid-cols-[1fr_88px]">
                  {href ? (
                    <Link href={href} className="grid min-w-0 grid-cols-[52px_1fr] items-center gap-4 p-3 sm:grid-cols-[52px_1.4fr_1fr_1fr]">
                      {row}
                    </Link>
                  ) : (
                    <div className="grid min-w-0 grid-cols-[52px_1fr] items-center gap-4 p-3 sm:grid-cols-[52px_1.4fr_1fr_1fr]">{row}</div>
                  )}
                  <div className="flex items-center justify-end gap-1 pr-3">
                    <form action={recrawl.bind(null, s.id)}>
                      <button title="Run the audit again" aria-label={`Run the audit for ${s.hostname} again`} className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-line hover:text-ink">
                        <RotateCw className="size-4" />
                      </button>
                    </form>
                    {href && <ChevronRight className="size-4 text-muted" aria-hidden />}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
