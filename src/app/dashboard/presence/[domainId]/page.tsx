import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { defaultEntity, loadEntity } from "@/lib/entity-form";
import { journalistPitch, presence, reviewRequestEmail } from "@/lib/presence";
import { Card, SectionTitle } from "@/components/ui";
import { CopyBlock } from "@/components/copy-block";

const PRIORITY: Record<string, string> = { high: "bg-rose text-high", medium: "bg-peach", low: "bg-panel text-muted" };

export default async function PresencePage({ params }: { params: Promise<{ domainId: string }> }) {
  const { domainId } = await params;
  const { org } = await requireUser();
  const domain = await db.domain.findFirst({ where: { id: domainId, orgId: org.id }, include: { entity: true } });
  if (!domain) notFound();
  const entity = loadEntity(domain.entity, defaultEntity(domain.hostname, domain.brandName));
  const run = await db.visibilityRun.findFirst({ where: { domainId: domain.id, status: "completed", results: { some: { error: null } } }, orderBy: { createdAt: "desc" }, include: { results: { select: { citedUrls: true, error: true } } } });
  const answers = (run?.results ?? [])
    .filter((r) => !r.error)
    .map((r) => ({
      citedHosts: (r.citedUrls ? (JSON.parse(r.citedUrls) as { url: string }[]) : []).flatMap((c) => {
        try {
          return [new URL(c.url).hostname.toLowerCase().replace(/^www\./, "")];
        } catch {
          return [];
        }
      }),
    }));
  const { rows, publications, totalAnswers } = presence({ sameAs: entity.sameAs, answers, brandHost: domain.hostname.replace(/^www\./, "") });
  const brand = domain.brandName || entity.name;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/dashboard/visibility/${domain.id}`} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> AI visibility
        </Link>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">Where AI looks besides your site</h1>
        <p className="mt-2 max-w-2xl text-xs text-muted">
          AI engines lean on review sites, communities and reference works. This ranks where to show up, using the sources AI cited in {totalAnswers ? `your latest ${totalAnswers} answers` : "your answers (run a visibility check first)"} and the profiles in your brand profile. Every step is for a person to do honestly; we never post for you.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <SectionTitle>Channels</SectionTitle>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.channel.id} className="rounded-2xl bg-panel p-4">
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${PRIORITY[r.priority]}`}>{r.priority}</span>
                    <span className="font-semibold">{r.channel.label}</span>
                    {r.listed && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-ok">
                        <Check className="size-3" /> listed
                      </span>
                    )}
                    <span className="w-full text-xs text-muted sm:w-auto">{r.reason}</span>
                  </summary>
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
                    {r.channel.claim.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ol>
                  {r.channel.caution && <p className="mt-2 text-xs text-high">{r.channel.caution}</p>}
                </details>
              </li>
            ))}
          </ul>
          {!entity.sameAs.length && (
            <p className="mt-3 text-xs text-muted">
              Add your existing profiles on the{" "}
              <Link href={`/dashboard/entity/${domain.id}`} className="underline underline-offset-4">
                Brand profile
              </Link>{" "}
              page so we can tell which ones you already have.
            </p>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <SectionTitle>Publications AI cites in your space</SectionTitle>
            {publications.length === 0 ? (
              <p className="text-sm text-muted">None yet. These appear after a visibility check.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {publications.map((p) => (
                  <li key={p.host} className="flex justify-between gap-3 rounded-xl bg-panel px-3 py-2">
                    <span className="truncate">{p.host}</span>
                    <span className="shrink-0 text-xs text-muted">{p.answers} answers</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">Good targets for original data, expert comments, or correcting outdated facts about you.</p>
          </Card>
          <Card className="space-y-4">
            <SectionTitle>Templates</SectionTitle>
            <CopyBlock label="Review request email" code={reviewRequestEmail(brand, domain.hostname)} />
            <CopyBlock label="Journalist pitch with original data" code={journalistPitch(brand, domain.category ?? "")} />
          </Card>
        </div>
      </div>
    </div>
  );
}
