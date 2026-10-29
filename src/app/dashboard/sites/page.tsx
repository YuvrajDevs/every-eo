import Link from "next/link";
import { RotateCw } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getSites } from "@/lib/sites";
import { recrawl } from "@/app/actions";
import { AddDomainForm } from "@/components/forms";
import { toneFor } from "@/components/site-card";
import { Card, ScoreRing, StatusPill, TONES } from "@/components/ui";

export default async function SitesPage() {
  const { org } = await requireUser();
  const sites = await getSites(org.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-4xl sm:text-5xl">Websites</h1>
          <p className="mt-2 text-muted">Every site in your workspace, with its latest audit.</p>
        </div>
        <div className="w-full sm:max-w-md">
          <AddDomainForm />
        </div>
      </div>

      {sites.length === 0 ? (
        <Card className="text-center text-muted">No websites yet. Add your first one above.</Card>
      ) : (
        <Card className="p-2 sm:p-3">
          <ul className="divide-y divide-line">
            {sites.map((s, i) => (
              <li key={s.id} className="flex flex-col gap-4 p-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <span className={`grid size-12 shrink-0 place-items-center rounded-2xl font-display text-lg ${TONES[toneFor(i)]}`}>
                    {s.hostname[0].toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{s.hostname}</p>
                    <p className="text-xs text-muted">
                      {s.latest
                        ? `${s.latest.pagesCount} pages · ${s.high} urgent · ${s.medium} medium · ${s.latest.createdAt.toLocaleString()}`
                        : "Not audited yet"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:justify-end">
                  {s.score !== null ? <ScoreRing score={s.score} size={44} /> : s.latest && <StatusPill status={s.latest.status} />}
                  {s.latest && (
                    <Link href={`/dashboard/crawls/${s.latest.id}`} className="rounded-full bg-ink px-4 py-2 text-xs text-accent-ink hover:opacity-85">
                      View report
                    </Link>
                  )}
                  <form action={recrawl.bind(null, s.id)}>
                    <button title="Run the audit again" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-2 text-xs hover:border-ink">
                      <RotateCw className="size-3.5" /> Re-run
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
