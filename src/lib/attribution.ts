import { columnIndex, parseCsv, toNumber } from "@/lib/csv";

// Compares AI visibility over time with branded search demand. It reports association with an honest test, never
// causation: both can move for other reasons (seasonality, campaigns, PR).

export const SEARCH_SOURCES = {
  gsc_branded: "Google Search Console · branded queries",
  gsc_all: "Google Search Console · all queries",
  bing_branded: "Bing Webmaster Tools · branded queries",
  bing_all: "Bing Webmaster Tools · all queries",
} as const;
export type SearchSource = keyof typeof SEARCH_SOURCES;

export type Day = { date: Date; clicks: number; impressions: number };

function parseDate(s: string): Date | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // Bing exports use M/D/YYYY
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return null;
}

// Search Console "Dates" export, or Bing "Search Performance" export: one row per day with clicks and impressions.
export function parseDailyCsv(csv: string): { days: Day[]; error?: string } {
  const t = parseCsv(csv);
  if (t.length < 2) return { days: [], error: "That file has no rows." };
  const d = columnIndex(t[0], "Date", "Day");
  const c = columnIndex(t[0], "Clicks");
  const i = columnIndex(t[0], "Impressions");
  if (d < 0 || c < 0 || i < 0) return { days: [], error: "Expected a daily export with Date, Clicks and Impressions columns (Search Console: the Dates.csv file)." };
  const days = t.slice(1).flatMap((r) => {
    const date = parseDate(r[d] ?? "");
    const clicks = toNumber(r[c]);
    const impressions = toNumber(r[i]);
    return date && clicks !== null && impressions !== null ? [{ date, clicks, impressions }] : [];
  });
  return days.length ? { days } : { days, error: "No rows with a readable date." };
}

export function weekStart(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); // Monday
  return x.toISOString().slice(0, 10);
}

// Only complete weeks (7 days of data) count, so a half-imported week doesn't look like a drop.
export function weeklyClicks(days: Day[]) {
  const m = new Map<string, { clicks: number; days: number }>();
  for (const d of days) {
    const w = weekStart(d.date);
    const e = m.get(w) ?? { clicks: 0, days: 0 };
    e.clicks += d.clicks;
    e.days++;
    m.set(w, e);
  }
  return new Map([...m].filter(([, v]) => v.days === 7).map(([w, v]) => [w, v.clicks]));
}

export function weeklyMentionRate(runs: { createdAt: Date; mentioned: number; total: number }[]) {
  const m = new Map<string, { mentioned: number; total: number }>();
  for (const r of runs) {
    if (r.total === 0) continue;
    const w = weekStart(r.createdAt);
    const e = m.get(w) ?? { mentioned: 0, total: 0 };
    e.mentioned += r.mentioned;
    e.total += r.total;
    m.set(w, e);
  }
  return new Map([...m].map(([w, v]) => [w, v.mentioned / v.total]));
}

function ranks(xs: number[]) {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1; // average rank for ties
    i = j + 1;
  }
  return r;
}

function pearson(a: number[], b: number[]) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

export const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));

// Two-sided permutation test with a fixed seed, so the same data always gives the same answer.
export function permutationP(a: number[], b: number[], iterations = 5000) {
  const observed = Math.abs(spearman(a, b));
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const shuffled = [...b];
  let hits = 0;
  for (let it = 0; it < iterations; it++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (Math.abs(spearman(a, shuffled)) >= observed - 1e-12) hits++;
  }
  return (hits + 1) / (iterations + 1);
}

export const MIN_WEEKS = 6;

export type Association = { lagWeeks: number; weeks: number; rho: number; p: number };

const addWeeks = (w: string, n: number) => {
  const d = new Date(`${w}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * n);
  return d.toISOString().slice(0, 10);
};

// Lag k: AI visibility in week w against branded clicks in week w+k (visibility leading search demand).
export function associate(visibility: Map<string, number>, clicks: Map<string, number>, lagWeeks: number): Association | null {
  const pairs = [...visibility].flatMap(([w, v]) => {
    const c = clicks.get(addWeeks(w, lagWeeks));
    return c === undefined ? [] : [[v, c] as const];
  });
  if (pairs.length < MIN_WEEKS) return null;
  const a = pairs.map((p) => p[0]);
  const b = pairs.map((p) => p[1]);
  return { lagWeeks, weeks: pairs.length, rho: spearman(a, b), p: permutationP(a, b) };
}

export function describe(a: Association) {
  const strength = Math.abs(a.rho) < 0.3 ? "weak" : Math.abs(a.rho) < 0.6 ? "moderate" : "strong";
  const dir = a.rho >= 0 ? "rose and fell with" : "moved opposite to";
  const lag = a.lagWeeks === 0 ? "the same week" : `${a.lagWeeks} week${a.lagWeeks > 1 ? "s" : ""} later`;
  const chance = a.p < 0.05 ? "is unlikely to be chance alone" : "could easily be chance";
  return `Across ${a.weeks} weeks, branded search clicks ${dir} AI mentions ${lag} (${strength}, ρ = ${a.rho.toFixed(2)}, p = ${a.p.toFixed(3)}); this ${chance}. Correlation doesn't show the AI mentions caused it.`;
}

// Average weekly branded clicks in the N complete weeks before and after a date (e.g. when fixes went live).
export function beforeAfter(clicks: Map<string, number>, pivot: Date, weeks = 4) {
  const p = weekStart(pivot);
  const before = [...clicks].filter(([w]) => w < p).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-weeks).map(([, c]) => c);
  const after = [...clicks].filter(([w]) => w > p).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, weeks).map(([, c]) => c);
  if (before.length < weeks || after.length < weeks) return null;
  const mb = before.reduce((s, v) => s + v, 0) / weeks;
  const ma = after.reduce((s, v) => s + v, 0) / weeks;
  return { before: mb, after: ma, change: mb === 0 ? null : (ma - mb) / mb };
}
