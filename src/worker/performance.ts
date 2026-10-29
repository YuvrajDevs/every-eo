import type { FindingInput } from "@/worker/robots";

export type PerformanceReport = {
  url: string;
  strategy: "mobile";
  score: number | null; // Lighthouse lab score 0-100
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  field: { category: string | null; lcpMs: number | null; inpMs: number | null; cls: number | null } | null;
  error?: string;
};

type PsiAudit = { numericValue?: number };
type PsiMetric = { percentile?: number };
type PsiResponse = {
  lighthouseResult?: { categories?: { performance?: { score?: number } }; audits?: Record<string, PsiAudit> };
  loadingExperience?: { overall_category?: string; metrics?: Record<string, PsiMetric> };
  error?: { message?: string };
};

// Google PageSpeed Insights: lab data (Lighthouse) plus real-user Core Web Vitals when Google has them.
export async function measurePerformance(url: string): Promise<PerformanceReport> {
  const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  api.searchParams.set("url", url);
  api.searchParams.set("strategy", "mobile");
  api.searchParams.set("category", "performance");
  if (process.env.PSI_API_KEY) api.searchParams.set("key", process.env.PSI_API_KEY);

  const empty: PerformanceReport = { url, strategy: "mobile", score: null, lcpMs: null, cls: null, tbtMs: null, field: null };
  try {
    const res = await fetch(api, { signal: AbortSignal.timeout(90_000) });
    const data = (await res.json()) as PsiResponse;
    if (!res.ok) return { ...empty, error: data.error?.message ?? `PageSpeed API returned ${res.status}` };
    const audits = data.lighthouseResult?.audits ?? {};
    const m = data.loadingExperience?.metrics;
    const perf = data.lighthouseResult?.categories?.performance?.score;
    return {
      url,
      strategy: "mobile",
      score: typeof perf === "number" ? Math.round(perf * 100) : null,
      lcpMs: audits["largest-contentful-paint"]?.numericValue ?? null,
      cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
      tbtMs: audits["total-blocking-time"]?.numericValue ?? null,
      field: m
        ? {
            category: data.loadingExperience?.overall_category ?? null,
            lcpMs: m.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
            inpMs: m.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
            cls: m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
          }
        : null,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

export function performanceFindings(p: PerformanceReport): FindingInput[] {
  const f: FindingInput[] = [];
  const base = { layer: "seo" as const, evidence: "plausible" as const, url: p.url };
  if (p.field?.category === "SLOW") {
    f.push({ ...base, code: "cwv_field_poor", severity: "high", title: "Real visitors see a slow homepage", detail: "Google's real-user data (Core Web Vitals) rates your homepage as slow. Google treats passing Core Web Vitals as a baseline; failing it can hold back rankings and AI Overview inclusion." });
  }
  if (p.score !== null && p.score < 50) {
    f.push({ ...base, code: "perf_score_low", severity: "medium", title: `Mobile performance score is ${p.score}/100`, detail: "In Google's lab test your homepage loads slowly on mobile. Compress images, remove unused scripts and defer anything not needed for the first screen." });
  }
  if (p.lcpMs !== null && p.lcpMs > 4000) {
    f.push({ ...base, code: "lcp_slow", severity: "medium", title: `Main content takes ${(p.lcpMs / 1000).toFixed(1)}s to appear on mobile`, detail: "Largest Contentful Paint over 4 seconds is rated poor by Google. Aim for under 2.5 seconds." });
  }
  if (p.cls !== null && p.cls > 0.25) {
    f.push({ ...base, code: "cls_high", severity: "low", title: "Page layout jumps while loading", detail: "Cumulative Layout Shift above 0.25 is rated poor. Reserve space for images and embeds so content doesn't move." });
  }
  return f;
}
