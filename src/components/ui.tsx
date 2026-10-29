import type { LucideIcon } from "lucide-react";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-3xl bg-surface p-6 ${className}`}>{children}</section>;
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="font-display text-2xl">{children}</h2>
      {action}
    </div>
  );
}

export const inputClass =
  "w-full rounded-full border border-line bg-surface px-5 py-3 text-ink outline-none transition placeholder:text-muted focus:border-ink";

export const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 font-medium text-accent-ink transition hover:opacity-85 disabled:opacity-50";

export const ghostButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm transition hover:border-ink";

export const TONES = {
  lavender: "bg-lavender",
  peach: "bg-peach",
  mint: "bg-mint",
  rose: "bg-rose",
  lime: "bg-lime",
  sky: "bg-sky",
  white: "bg-surface",
} as const;
export type Tone = keyof typeof TONES;

export function StatTile({
  label,
  value,
  icon: Icon,
  tone = "white",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col justify-between gap-4 rounded-3xl p-5 sm:gap-6 ${TONES[tone]}`}>
      {Icon && (
        <span className="grid size-10 place-items-center rounded-full bg-surface/80">
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
      )}
      <div>
        <p className="font-display text-4xl">{value}</p>
        <p className="mt-1 text-xs text-ink/70">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] text-ink/55">{hint}</p>}
      </div>
    </div>
  );
}

const severityStyles: Record<string, string> = {
  high: "bg-rose text-high",
  medium: "bg-peach text-medium",
  low: "bg-sky text-low",
  info: "bg-panel text-muted",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${severityStyles[severity] ?? severityStyles.info}`}>
      {severity}
    </span>
  );
}

const layerStyles: Record<string, string> = {
  seo: "bg-sky",
  aeo: "bg-lavender",
  geo: "bg-mint",
};

export function LayerBadge({ layer }: { layer: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase ${layerStyles[layer] ?? "bg-panel"}`}>
      {layer}
    </span>
  );
}

const evidenceLabels: Record<string, string> = {
  proven: "Proven lever",
  plausible: "Plausible lever",
  speculative: "Speculative",
};

export function EvidenceBadge({ evidence }: { evidence: string }) {
  return (
    <span
      title="How strong the public evidence is that fixing this improves visibility"
      className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted"
    >
      {evidenceLabels[evidence] ?? evidence}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const style =
    status === "completed"
      ? "bg-mint text-ok"
      : status === "failed"
        ? "bg-rose text-high"
        : "bg-lavender text-ink";
  const label = status === "running" ? "Auditing" : status;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium capitalize ${style}`}>
      {(status === "running" || status === "queued") && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {label}
    </span>
  );
}

export function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const color = score >= 80 ? "var(--ok)" : score >= 50 ? "var(--medium)" : "var(--high)";
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 50 50" className="absolute inset-0 -rotate-90">
        <circle cx="25" cy="25" r={r} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="4" />
        <circle
          cx="25"
          cy="25"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
        />
      </svg>
      <span className="font-display text-lg">{score}</span>
    </div>
  );
}
