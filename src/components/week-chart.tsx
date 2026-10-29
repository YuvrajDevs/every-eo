// One series over weeks, as a thin line with point markers. Charts that share weeks are stacked as small multiples
// (never two y-axes on one chart). Native SVG <title> gives each point a hover tooltip; a table follows for exact values.

export function WeekChart({ title, weeks, values, format }: { title: string; weeks: string[]; values: (number | null)[]; format: (v: number) => string }) {
  const W = 640;
  const H = 160;
  const pad = { l: 44, r: 12, t: 12, b: 24 };
  const nums = values.filter((v): v is number => v !== null);
  const max = nums.length ? Math.max(...nums) : 1;
  const top = max === 0 ? 1 : max * 1.1;
  const x = (i: number) => pad.l + (weeks.length <= 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (weeks.length - 1));
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const segments: string[] = [];
  let current = "";
  values.forEach((v, i) => {
    if (v === null) {
      if (current) segments.push(current);
      current = "";
    } else current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const label = (w: string) => new Date(`${w}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  const tickEvery = Math.max(1, Math.ceil(weeks.length / 6));

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-xs font-semibold">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-ink" role="img" aria-label={`${title}, ${nums.length} weeks of data`}>
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="stroke-line" strokeWidth={1} />
        <line x1={pad.l} x2={W - pad.r} y1={y(top / 1.1)} y2={y(top / 1.1)} className="stroke-line" strokeWidth={1} strokeDasharray="3 4" />
        <text x={pad.l - 6} y={y(top / 1.1) + 4} textAnchor="end" className="fill-muted text-[11px]">
          {format(top / 1.1)}
        </text>
        <text x={pad.l - 6} y={y(0) + 4} textAnchor="end" className="fill-muted text-[11px]">
          {format(0)}
        </text>
        {weeks.map((w, i) =>
          i % tickEvery === 0 ? (
            <text key={w} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted text-[11px]">
              {label(w)}
            </text>
          ) : null,
        )}
        {segments.map((d) => (
          <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {values.map((v, i) =>
          v === null ? null : (
            <g key={weeks[i]}>
              <circle cx={x(i)} cy={y(v)} r={4} fill="currentColor" className="stroke-surface" strokeWidth={2} />
              <circle cx={x(i)} cy={y(v)} r={12} fill="transparent">
                <title>{`Week of ${label(weeks[i])}: ${format(v)}`}</title>
              </circle>
            </g>
          ),
        )}
      </svg>
    </figure>
  );
}
