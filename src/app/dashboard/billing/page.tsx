import { requireUser } from "@/lib/auth";
import { PLANS, planFor, priceFor } from "@/lib/plans";
import { usageThisMonth } from "@/lib/usage";
import { billingEnabled } from "@/lib/stripe";
import { openBillingPortal, startCheckout } from "@/app/actions";
import { Card, SectionTitle } from "@/components/ui";

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pctUsed = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="tabular-nums text-muted">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-panel" role="meter" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}>
        <div className={`h-2 rounded-full ${pctUsed >= 90 ? "bg-high" : "bg-ink"}`} style={{ width: `${pctUsed}%` }} />
      </div>
    </div>
  );
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  const { org } = await requireUser();
  const plan = planFor(org.plan);
  const usage = await usageThisMonth(org.id);
  const enabled = billingEnabled();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl sm:text-5xl">Billing</h1>
        <p className="mt-2 text-xs text-muted">Your plan, what you&apos;ve used this month, and upgrades.</p>
      </div>
      {checkout === "success" && (
        <Card className="bg-mint">
          <p className="font-semibold">Thanks — your payment went through.</p>
          <p className="mt-1 text-sm">Your plan updates as soon as Stripe confirms the subscription, usually within a few seconds.</p>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card className="space-y-4">
          <SectionTitle>{plan.name} plan</SectionTitle>
          {org.planStatus && <p className="-mt-3 text-xs text-muted">Subscription {org.planStatus}{org.currentPeriodEnd ? ` · renews ${org.currentPeriodEnd.toLocaleDateString()}` : ""}</p>}
          <Meter label="AI answers this month" used={usage.answers} limit={plan.monthlyAnswers} />
          <Meter label="Websites" used={usage.sites} limit={plan.sites} />
          <p className="text-xs text-muted">
            {usage.audits} audits and {usage.fixes} fixes applied this month. Up to {plan.pagesPerAudit} pages per audit, {plan.promptsPerSite} questions per site, {plan.maxTrials} repeats per question.
          </p>
          {org.stripeCustomerId && enabled && (
            <form action={openBillingPortal}>
              <button className="rounded-full border border-line px-4 py-2 text-xs hover:border-ink">Manage subscription</button>
            </form>
          )}
        </Card>
        <Card>
          <SectionTitle>Plans</SectionTitle>
          {!enabled && <p className="mb-4 rounded-xl bg-panel px-3 py-2 text-xs text-muted">Online payment isn&apos;t set up yet. Add STRIPE_SECRET_KEY and a price ID per plan to enable upgrades.</p>}
          <ul className="space-y-2">
            {Object.values(PLANS)
              .filter((p) => p.id !== "trial")
              .map((p) => (
                <li key={p.id} className="flex flex-col gap-3 rounded-2xl bg-panel p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-muted">
                      {p.sites} sites · {p.monthlyAnswers.toLocaleString()} AI answers/month · {p.pagesPerAudit} pages per audit · auto-fix
                    </p>
                  </div>
                  {p.id === plan.id ? (
                    <span className="text-xs font-semibold">Current plan</span>
                  ) : (
                    <form action={startCheckout.bind(null, p.id)}>
                      <button disabled={!enabled || !priceFor(p)} className="rounded-full bg-ink px-4 py-2 text-xs text-accent-ink hover:opacity-85 disabled:opacity-40">
                        Choose {p.name}
                      </button>
                    </form>
                  )}
                </li>
              ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
