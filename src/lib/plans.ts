// What each plan includes. Prices live in Stripe (one price ID per plan, set via env) so they can change without a
// deploy. Limits are placeholders to tune once real per-answer costs are measured (see the Costs page).

export type PlanId = "trial" | "starter" | "growth" | "advanced";

export type Plan = {
  id: PlanId;
  name: string;
  sites: number;
  pagesPerAudit: number;
  promptsPerSite: number;
  maxTrials: number;
  monthlyAnswers: number; // AI answers (prompt × engine × trial) per calendar month, across all sites
  autoFix: boolean;
  schedules: ("weekly" | "monthly")[];
  priceEnv?: string;
};

export const PLANS: Record<PlanId, Plan> = {
  trial: { id: "trial", name: "Trial", sites: 3, pagesPerAudit: 50, promptsPerSite: 15, maxTrials: 10, monthlyAnswers: 300, autoFix: true, schedules: ["weekly", "monthly"] },
  starter: { id: "starter", name: "Starter", sites: 3, pagesPerAudit: 200, promptsPerSite: 50, maxTrials: 5, monthlyAnswers: 4_000, autoFix: true, schedules: ["weekly", "monthly"], priceEnv: "STRIPE_PRICE_STARTER" },
  growth: { id: "growth", name: "Growth", sites: 10, pagesPerAudit: 500, promptsPerSite: 100, maxTrials: 10, monthlyAnswers: 20_000, autoFix: true, schedules: ["weekly", "monthly"], priceEnv: "STRIPE_PRICE_GROWTH" },
  advanced: { id: "advanced", name: "Advanced", sites: 50, pagesPerAudit: 1_000, promptsPerSite: 200, maxTrials: 10, monthlyAnswers: 100_000, autoFix: true, schedules: ["weekly", "monthly"], priceEnv: "STRIPE_PRICE_ADVANCED" },
};

export function planFor(id: string | null | undefined): Plan {
  return PLANS[(id ?? "trial") as PlanId] ?? PLANS.trial;
}

export function planForPrice(priceId: string): Plan | null {
  return Object.values(PLANS).find((p) => p.priceEnv && process.env[p.priceEnv] === priceId) ?? null;
}

export function priceFor(plan: Plan) {
  return plan.priceEnv ? process.env[plan.priceEnv] || null : null;
}

export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
