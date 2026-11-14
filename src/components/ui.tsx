import type { LucideIcon } from "lucide-react";

// Panels are flat graphite on the near-black canvas. Radius steps down with depth:
// frame 28 → panel 22 → tile 14 → controls fully round.
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-[22px] bg-surface p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function SectionTitle({ children, action, hint }: { children: React.ReactNode; action?: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{children}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

// Page header used across the app: title, one line of context, actions on the right.
export function PageHeader({ title, context, back, actions }: { title: React.ReactNode; context?: React.ReactNode; back?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="mt-1 truncate font-display text-3xl sm:text-4xl">{title}</h1>
        {context && <div className="mt-1.5 text-sm text-muted">{context}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export const inputClass =
  "w-full rounded-full border border-line bg-panel px-5 py-3 text-ink outline-none transition placeholder:text-muted/60 focus:border-highlight/60";

export const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50";

export const ghostButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-panel px-4 py-2 text-sm text-ink transition hover:bg-line disabled:opacity-50";

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

// Value colour carries the meaning on tinted tiles; the tint itself stays quiet.
const TONE_VALUE: Partial<Record<Tone, string>> = {
  rose: "text-high",
  mint: "text-ok",
  peach: "text-medium",
  sky: "text-low",
  lime: "text-highlight",
};

// Instrument readout: small label, bold value, optional hint. Mirrors the cockpit-style telemetry in the UI.
export function Readout({ label, value, hint, className = "" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

// Slim horizontal meter (0–100). Colour follows the same good / warn / bad thresholds as the score dial.
export function Meter({ value, tone, className = "" }: { value: number; tone?: "ok" | "medium" | "high" | "ink"; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const color = tone ?? (v >= 80 ? "ok" : v >= 50 ? "medium" : "high");
  const fill = { ok: "bg-ok", medium: "bg-medium", high: "bg-high", ink: "bg-ink" }[color];
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-line ${className}`} role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${v}%` }} />
    </div>
  );
}

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
    <div className={`flex min-w-0 flex-col justify-between gap-6 rounded-[22px] p-5 ${TONES[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted">{label}</p>
        {Icon && <Icon className="size-4 shrink-0 text-muted" strokeWidth={1.75} />}
      </div>
      <div>
        <p className={`font-display text-4xl ${TONE_VALUE[tone] ?? ""}`}>{value}</p>
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
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
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${severityStyles[severity] ?? severityStyles.info}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {severity}
    </span>
  );
}

const layerNames: Record<string, string> = { seo: "SEO", aeo: "AEO", geo: "GEO" };

export function LayerBadge({ layer }: { layer: string }) {
  return <span className="rounded-full bg-panel px-2.5 py-0.5 text-[11px] font-medium text-ink/80">{layerNames[layer] ?? layer}</span>;
}

const evidenceLabels: Record<string, string> = {
  proven: "Proven lever",
  plausible: "Plausible lever",
  speculative: "Speculative",
};

export function EvidenceBadge({ evidence }: { evidence: string }) {
  return (
    <span title="How strong the public evidence is that fixing this improves visibility" className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted">
      {evidenceLabels[evidence] ?? evidence}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const style = status === "completed" ? "bg-mint text-ok" : status === "failed" ? "bg-rose text-high" : "bg-panel text-highlight";
  const label = status === "running" ? "Running" : status;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium capitalize ${style}`}>
      <span className={`size-1.5 rounded-full bg-current ${status === "running" || status === "queued" ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

const TICKS = 48;

// The signature element: a dial with tick marks (like an instrument bezel). Lit ticks show the score.
export function ScoreRing({ score, size = 56, label }: { score: number; size?: number; label?: string }) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const color = s >= 80 ? "var(--ok)" : s >= 50 ? "var(--medium)" : "var(--high)";
  const lit = Math.round((s / 100) * TICKS);
  const big = size >= 80;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${label ?? "Score"} ${s} out of 100`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0">
        {Array.from({ length: TICKS }, (_, i) => {
          const a = (i / TICKS) * 2 * Math.PI - Math.PI / 2;
          const long = i % 12 === 0;
          const r1 = long ? 38 : 41;
          const r2 = 47;
          return (
            <line
              key={i}
              x1={50 + r1 * Math.cos(a)}
              y1={50 + r1 * Math.sin(a)}
              x2={50 + r2 * Math.cos(a)}
              y2={50 + r2 * Math.sin(a)}
              stroke={i < lit ? color : "currentColor"}
              strokeOpacity={i < lit ? 1 : 0.16}
              strokeWidth={long ? 2.6 : 2}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <span className={`font-display ${big ? "text-3xl" : "text-base"}`}>{s}</span>
    </div>
  );
}
