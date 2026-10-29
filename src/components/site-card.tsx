import Link from "next/link";
import { ArrowUpRight, Globe } from "lucide-react";
import type { Site } from "@/lib/sites";
import { ScoreRing, StatusPill, TONES, type Tone } from "@/components/ui";

const CYCLE: Tone[] = ["lavender", "peach", "lime", "mint", "rose", "sky"];

export function toneFor(index: number): Tone {
  return CYCLE[index % CYCLE.length];
}

export function SiteCard({ site, index }: { site: Site; index: number }) {
  const href = site.latest ? `/dashboard/crawls/${site.latest.id}` : "/dashboard/sites";
  return (
    <Link
      href={href}
      className={`group flex min-h-[150px] flex-col sm:min-h-[200px] justify-between rounded-3xl p-5 text-ink transition hover:-translate-y-0.5 ${TONES[toneFor(index)]}`}
    >
      <div className="flex items-start justify-between">
        <span className="text-xs text-ink/60">{String(index + 1).padStart(2, "0")}</span>
        <ArrowUpRight className="size-4 opacity-50 transition group-hover:opacity-100" strokeWidth={1.75} />
      </div>
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <Globe className="size-6" strokeWidth={1.5} />
          {site.score !== null ? <ScoreRing score={site.score} size={48} /> : site.latest && <StatusPill status={site.latest.status} />}
        </div>
        <p className="truncate font-display text-xl">{site.hostname}</p>
        <p className="mt-1 text-[11px] text-ink/65">
          {site.latest ? `${site.latest.pagesCount} pages · ${site.high} urgent` : "Not audited yet"}
        </p>
      </div>
    </Link>
  );
}
