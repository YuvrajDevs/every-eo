import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ENGINES } from "@/lib/engines";
import { Card, SectionTitle } from "@/components/ui";

const DAYS = 30;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

// PRD Starter scope: 50–100 prompts across 4 engines. Trials follow the roadmap's 5–10 range.
const SCENARIOS = [
  { label: "One-time audit", prompts: 25, trials: 5, runsPerMonth: 1, price: "$500–3,500" },
  { label: "Starter, monthly", prompts: 50, trials: 5, runsPerMonth: 1, price: "$999–2,100" },
  { label: "Starter, weekly", prompts: 100, trials: 5, runsPerMonth: 4, price: "$999–2,100" },
  { label: "Growth, weekly", prompts: 100, trials: 10, runsPerMonth: 4, price: "$2,250–5,500" },
];

export default async function CostsPage() {
  const { org } = await requireUser();
  const since = daysAgo(DAYS);
  const logs = await db.apiCallLog.findMany({ where: { orgId: org.id, createdAt: { gte: since } } });

  const byProvider = new Map<string, { units: number; micros: number }>();
  for (const l of logs) {
    const p = byProvider.get(l.provider) ?? { units: 0, micros: 0 };
    p.units += l.units;
    p.micros += l.costMicros;
    byProvider.set(l.provider, p);
  }
  const total = [...byProvider.values()].reduce((n, p) => n + p.micros, 0);

  // Average measured cost per AI answer, per engine; engines never run yet are excluded from projections.
  const perCall = ENGINES.flatMap((e) => {
    const p = byProvider.get(e.id);
    return p && p.units > 0 && p.micros > 0 ? [{ engine: e, avg: p.micros / p.units }] : [];
  });
  const avgAcrossEngines = perCall.length ? perCall.reduce((n, c) => n + c.avg, 0) / perCall.length : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl sm:text-5xl">Costs</h1>
        <p className="mt-2 text-xs text-muted">Real API spend for your workspace over the last {DAYS} days, and what it implies for pricing.</p>
      </div>

      <Card>
        <SectionTitle>Spend by provider</SectionTitle>
        {byProvider.size === 0 ? (
          <p className="text-sm text-muted">No billable calls logged yet. Run an AI answer check to start measuring.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr><th className="pb-2 font-normal">Provider</th><th className="pb-2 text-right font-normal">Calls</th><th className="pb-2 text-right font-normal">Cost</th><th className="pb-2 text-right font-normal">Per call</th></tr>
            </thead>
            <tbody>
              {[...byProvider].sort((a, b) => b[1].micros - a[1].micros).map(([provider, p]) => (
                <tr key={provider} className="border-t border-line">
                  <td className="py-2">{ENGINES.find((e) => e.id === provider)?.label ?? provider}</td>
                  <td className="py-2 text-right tabular-nums">{p.units}</td>
                  <td className="py-2 text-right tabular-nums">{usd(p.micros)}</td>
                  <td className="py-2 text-right tabular-nums">{p.units ? `$${(p.micros / p.units / 1_000_000).toFixed(4)}` : "—"}</td>
                </tr>
              ))}
              <tr className="border-t border-ink font-semibold">
                <td className="py-2">Total</td><td /><td className="py-2 text-right tabular-nums">{usd(total)}</td><td />
              </tr>
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <SectionTitle>What a plan costs to serve</SectionTitle>
        {avgAcrossEngines === null ? (
          <p className="text-sm text-muted">Needs at least one completed AI answer check to project from real numbers.</p>
        ) : (
          <>
            <p className="mb-4 text-xs text-muted">
              Projected from your measured average of ${(avgAcrossEngines / 1_000_000).toFixed(4)} per answer across {perCall.length} engine{perCall.length === 1 ? "" : "s"}, assuming all 4 engines. Crawling and PageSpeed are logged at $0 today; add hosting and rendering costs before trusting margins.
            </p>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr><th className="pb-2 font-normal">Scenario</th><th className="pb-2 text-right font-normal">Answers / mo</th><th className="pb-2 text-right font-normal">Est. API cost / mo</th><th className="pb-2 text-right font-normal">Planned price</th></tr>
              </thead>
              <tbody>
                {SCENARIOS.map((s) => {
                  const calls = s.prompts * 4 * s.trials * s.runsPerMonth;
                  return (
                    <tr key={s.label} className="border-t border-line">
                      <td className="py-2">{s.label} <span className="text-xs text-muted">({s.prompts} prompts × {s.trials} trials{s.runsPerMonth > 1 ? ` × ${s.runsPerMonth}` : ""})</span></td>
                      <td className="py-2 text-right tabular-nums">{calls.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums">{usd(calls * avgAcrossEngines)}</td>
                      <td className="py-2 text-right tabular-nums text-muted">{s.price}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );
}
