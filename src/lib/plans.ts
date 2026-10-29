// What each plan includes. Prices live in Stripe (one price ID per plan, set via env) so they can change without a
// deploy. Limits are placeholders to tune once real per-answer costs are measured (see the Costs page).

export type PlanId = "trial" | "starter" | "growth" | "advanced" | "agency";

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
  api?: boolean; // REST API access
  // Agency plans: how many client workspaces, and what each client workspace gets. Billed per client (Stripe quantity).
  maxClients?: number;
  clientAllowance?: Omit<Plan, "id" | "name" | "priceEnv" | "maxClients" | "clientAllowance">;
};

export const PLANS: Record<PlanId, Plan> = {
  trial: { id: "trial", name: "Trial", sites: 3, pagesPerAudit: 50, promptsPerSite: 15, maxTrials: 10, monthlyAnswers: 300, autoFix: true, schedules: ["weekly", "monthly"] },
  starter: { id: "starter", name: "Starter", sites: 3, pagesPerAudit: 200, promptsPerSite: 50, maxTrials: 5, monthlyAnswers: 4_000, autoFix: true, schedules: ["weekly", "monthly"], priceEnv: "STRIPE_PRICE_STARTER" },
  growth: { id: "growth", name: "Growth", sites: 10, pagesPerAudit: 500, promptsPerSite: 100, maxTrials: 10, monthlyAnswers: 20_000, autoFix: true, schedules: ["weekly", "monthly"], priceEnv: "STRIPE_PRICE_GROWTH" },
  agency: {
    id: "agency",
    name: "Agency",
    sites: 3,
    pagesPerAudit: 200,
    promptsPerSite: 50,
    maxTrials: 5,
    monthlyAnswers: 2_000,
    autoFix: true,
    schedules: ["weekly", "monthly"],
    priceEnv: "STRIPE_PRICE_AGENCY_CLIENT",
    api: true,
    maxClients: 100,
    clientAllowance: { sites: 3, pagesPerAudit: 200, promptsPerSite: 50, maxTrials: 5, monthlyAnswers: 4_000, autoFix: true, schedules: ["weekly", "monthly"] },
  },
  advanced: { id: "advanced", name: "Advanced", sites: 50, pagesPerAudit: 1_000, promptsPerSite: 200, maxTrials: 10, monthlyAnswers: 100_000, autoFix: true, schedules: ["weekly", "monthly"], priceEnv: "STRIPE_PRICE_ADVANCED", api: true },
};

export function planFor(id: string | null | undefined): Plan {
  return PLANS[(id ?? "trial") as PlanId] ?? PLANS.trial;
}

// Agencies still on trial can try the client console with a couple of small client workspaces.
const AGENCY_TRIAL_CLIENTS = 2;

type OrgPlanInfo = { plan: string; kind: string; parent?: { plan: string } | null };

// The limits that apply to a workspace. A client workspace gets its agency's per-client allowance.
export function planForOrg(org: OrgPlanInfo): Plan {
  if (org.kind === "client") {
    const agencyPlan = planFor(org.parent?.plan);
    const { sites, pagesPerAudit, promptsPerSite, maxTrials, monthlyAnswers, autoFix, schedules } = agencyPlan.clientAllowance ?? PLANS.trial;
    return { id: agencyPlan.id, name: `${agencyPlan.name} client`, sites, pagesPerAudit, promptsPerSite, maxTrials, monthlyAnswers, autoFix, schedules };
  }
  const plan = planFor(org.plan);
  if (org.kind === "agency" && !plan.maxClients) return { ...plan, maxClients: AGENCY_TRIAL_CLIENTS };
  return plan;
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
