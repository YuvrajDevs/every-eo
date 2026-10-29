"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { createClientWorkspace, resolveAccess } from "@/lib/access";
import { brandingSchema } from "@/lib/branding";
import { createApiKey } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { isStaff } from "@/lib/staff";
import { createSession, destroySession, readSession } from "@/lib/session";
import { clientIpFrom } from "@/lib/client-ip";
import { sendVerificationEmail } from "@/lib/verification";
import { parseRecipients, sendReport } from "@/lib/notify";
import { nextRun, SCHEDULES, startCrawl, startVisibility } from "@/lib/jobs";
import { parseEntityForm } from "@/lib/entity-form";
import { loadFixContext } from "@/lib/fix-context";
import { parseFactsForm } from "@/lib/truth-form";
import { parseGscQueries } from "@/lib/discovery";
import { parseDailyCsv, SEARCH_SOURCES } from "@/lib/attribution";
import { estimateMicros, judgeModel } from "@/lib/judge";
import { judgeTargets } from "@/lib/judge-targets";
import { checkAnswerQuota } from "@/lib/usage";
import { enqueueJob } from "@/lib/queue";
import { truthCheck } from "@/worker/truth";
import { planForOrg, PLANS, type PlanId } from "@/lib/plans";
import { marketInfo } from "@/lib/markets";
import { createCheckout, createPortal, syncAgencySeats } from "@/lib/stripe";
import { applyFix, connectWordPress, rollbackFix, verifyFix } from "@/lib/fix-engine";
import { normalizeHostname, UnsafeUrlError } from "@/lib/url-safety";

// values: what the user submitted, sent back with an error so the form can show it again (React resets forms after
// every submission). Secrets are never echoed.
export type FormState = { error?: string; values?: Record<string, string> } | undefined;

const SECRET_FIELDS = new Set(["password", "appPassword"]);

function keep(formData: FormData) {
  return Object.fromEntries([...formData.entries()].filter(([k, v]) => typeof v === "string" && !SECRET_FIELDS.has(k) && !k.startsWith("$")) as [string, string][]);
}

// bcrypt only uses the first 72 bytes of a password; longer ones would silently be cut, so they're refused.
const passwordField = z
  .string()
  .min(10, "Use at least 10 characters")
  .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Use at most 72 bytes (about 72 letters)");

const signupSchema = z.object({
  agency: z.literal("yes").optional(),
  name: z.string().trim().min(1, "Enter your name").max(100),
  company: z.string().trim().min(1, "Enter your company or agency name").max(100),
  email: z.email("Enter a valid email").trim().toLowerCase(),
  password: passwordField,
});

// Client IP for rate limiting. Behind a proxy, only the left-most X-Forwarded-For entry set by your own proxy is
// trustworthy; see lib/client-ip.ts (TRUST_PROXY_HOPS).
async function clientIp() {
  return clientIpFrom(await headers());
}

// Some actions call other servers or do heavy work; cap them per workspace so one account can't abuse them.
function limitFor(orgId: string, action: string, max: number, windowMinutes: number) {
  const r = rateLimit(`action:${action}:${orgId}`, max, windowMinutes * 60_000);
  return r.ok ? null : `You're doing that too often. Try again in ${minutes(r.resetMs)} minutes.`;
}

// Billing, API keys, branding and client management are for workspace owners (and the owning agency's staff).
function requireManager(role: string) {
  if (role !== "owner" && role !== "agency") throw new Error("Only workspace owners can do this.");
}

// Compared against when an email has no account, so a login takes the same time either way (no account probing).
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-not-a-password", 12);

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

export async function signup(_: FormState, formData: FormData): Promise<FormState> {
  const limit = rateLimit(`signup:${await clientIp()}`, 5, 60 * 60_000);
  if (!limit.ok) return { error: `Too many sign-ups from your network. Try again in ${minutes(limit.resetMs)} minutes.`, values: keep(formData) };
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message, values: keep(formData) };
  const { name, company, email, password, agency } = parsed.data;

  if (await db.user.findUnique({ where: { email } })) {
    return { error: "An account with this email already exists. Log in instead.", values: keep(formData) };
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const { user, org } = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: company, kind: agency ? "agency" : "standard" } });
    const user = await tx.user.create({ data: { name, email, passwordHash } });
    await tx.membership.create({ data: { userId: user.id, orgId: org.id, role: "owner" } });
    return { user, org };
  });
  await createSession({ userId: user.id, orgId: org.id });
  try {
    await sendVerificationEmail(user, await appBaseUrl());
  } catch (err) {
    console.error("[mail] verification email failed:", err);
  }
  redirect("/dashboard");
}

const loginSchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password").max(1000),
});

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message, values: keep(formData) };
  // Per-account and per-network limits: slows password guessing against one user and spraying across many.
  const byEmail = rateLimit(`login:email:${parsed.data.email}`, 10, 15 * 60_000);
  const byIp = rateLimit(`login:ip:${await clientIp()}`, 30, 15 * 60_000);
  if (!byEmail.ok || !byIp.ok) return { error: `Too many login attempts. Try again in ${minutes(Math.max(byEmail.resetMs, byIp.resetMs))} minutes.`, values: keep(formData) };
  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  const ok = (await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH)) && Boolean(user);
  if (!ok || !user || user.memberships.length === 0) return { error: "Email or password is incorrect.", values: keep(formData) };
  await createSession({ userId: user.id, orgId: user.memberships[0].orgId });
  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function addDomainAndCrawl(_: FormState, formData: FormData): Promise<FormState> {
  const { org } = await requireUser();
  let hostname: string;
  try {
    hostname = normalizeHostname(String(formData.get("domain") ?? ""));
  } catch (err) {
    if (err instanceof UnsafeUrlError) return { error: err.message };
    throw err;
  }
  const limited = limitFor(org.id, "crawl", 30, 60);
  if (limited) return { error: limited };
  const plan = planForOrg(org);
  const exists = await db.domain.findUnique({ where: { orgId_hostname: { orgId: org.id, hostname } } });
  if (!exists && (await db.domain.count({ where: { orgId: org.id } })) >= plan.sites) {
    return { error: `Your ${plan.name} plan includes ${plan.sites} ${plan.sites === 1 ? "site" : "sites"}. Upgrade on the Billing page to add more.` };
  }
  const domain = await db.domain.upsert({
    where: { orgId_hostname: { orgId: org.id, hostname } },
    update: {},
    create: { orgId: org.id, hostname },
  });
  const crawlId = await startCrawlFor(org.id, domain.id);
  redirect(`/dashboard/crawls/${crawlId}`);
}

export async function recrawl(domainId: string) {
  const { org } = await requireUser();
  if (limitFor(org.id, "crawl", 30, 60)) throw new Error("Too many audits started this hour. Try again later.");
  const domain = await db.domain.findFirst({ where: { id: domainId, orgId: org.id } });
  if (!domain) throw new Error("Domain not found");
  const crawlId = await startCrawlFor(org.id, domain.id);
  redirect(`/dashboard/crawls/${crawlId}`);
}

async function ownedDomain(domainId: string) {
  const { org, role } = await requireUser();
  const domain = await db.domain.findFirst({ where: { id: domainId, orgId: org.id } });
  if (!domain) throw new Error("Domain not found");
  return { org, domain, role };
}

export async function addPrompt(domainId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { org, domain } = await ownedDomain(domainId);
  const MAX_PROMPTS = planForOrg(org).promptsPerSite;
  const text = String(formData.get("text") ?? "").trim().replace(/\s+/g, " ");
  if (text.length < 5) return { error: "Write the question the way a customer would ask it." };
  if (text.length > 300) return { error: "Keep questions under 300 characters." };
  const count = await db.prompt.count({ where: { domainId: domain.id } });
  if (count >= MAX_PROMPTS) return { error: `You can track up to ${MAX_PROMPTS} questions per site on your plan.` };
  const market = String(formData.get("market") ?? "");
  await db.prompt.create({ data: { domainId: domain.id, text, market: marketInfo(market) ? market : null } });
  revalidatePath(`/dashboard/visibility/${domain.id}`);
  return undefined;
}

export async function deletePrompt(promptId: string) {
  const { org } = await requireUser();
  const prompt = await db.prompt.findFirst({ where: { id: promptId, domain: { orgId: org.id } } });
  if (!prompt) throw new Error("Question not found");
  await db.prompt.delete({ where: { id: prompt.id } });
  revalidatePath(`/dashboard/visibility/${prompt.domainId}`);
}

export async function setBrandName(domainId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { domain } = await ownedDomain(domainId);
  const brandName = String(formData.get("brandName") ?? "").trim().slice(0, 80) || null;
  await db.domain.update({ where: { id: domain.id }, data: { brandName } });
  revalidatePath(`/dashboard/visibility/${domain.id}`);
  return undefined;
}

export async function startVisibilityRun(domainId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { org, domain } = await ownedDomain(domainId);
  const trials = [3, 5, 10].includes(Number(formData.get("trials"))) ? Number(formData.get("trials")) : 3;
  const result = await startVisibility(org.id, domain.id, trials);
  if ("error" in result) return { error: result.error };
  revalidatePath(`/dashboard/visibility/${domain.id}`);
  return undefined;
}

export async function setSchedules(domainId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { org, domain } = await ownedDomain(domainId);
  const allowed = planForOrg(org).schedules as string[];
  const pick = (key: string) => {
    const v = String(formData.get(key) ?? "off");
    return (SCHEDULES as readonly string[]).includes(v) && (v === "off" || allowed.includes(v)) ? v : "off";
  };
  const auditSchedule = pick("auditSchedule");
  const visibilitySchedule = pick("visibilitySchedule");
  const trials = Number(formData.get("visibilityTrials"));
  const now = new Date();
  await db.domain.update({
    where: { id: domain.id },
    data: {
      auditSchedule,
      visibilitySchedule,
      visibilityTrials: [3, 5, 10].includes(trials) ? trials : domain.visibilityTrials,
      // Keep an existing due date when the cadence didn't change, so saving the form doesn't postpone checks.
      nextAuditAt: auditSchedule === domain.auditSchedule && domain.nextAuditAt ? domain.nextAuditAt : nextRun(auditSchedule, now),
      nextVisibilityAt: visibilitySchedule === domain.visibilitySchedule && domain.nextVisibilityAt ? domain.nextVisibilityAt : nextRun(visibilitySchedule, now),
    },
  });
  revalidatePath(`/dashboard/visibility/${domain.id}`);
  return undefined;
}

export async function markAlertsRead() {
  const { org } = await requireUser();
  await db.alert.updateMany({ where: { orgId: org.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/dashboard/alerts");
}

async function startCrawlFor(orgId: string, domainId: string) {
  const crawlId = await startCrawl(orgId, domainId);
  revalidatePath("/dashboard");
  return crawlId;
}

export async function saveEntity(domainId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { domain } = await ownedDomain(domainId);
  const parsed = parseEntityForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message, values: keep(formData) };
  const data = JSON.stringify(parsed.data);
  await db.entityRecord.upsert({ where: { domainId: domain.id }, update: { data }, create: { domainId: domain.id, data } });
  revalidatePath(`/dashboard/entity/${domain.id}`);
  return undefined;
}

async function fixContext(domainId: string) {
  const { org, domain } = await ownedDomain(domainId);
  return { org, domain, ...(await loadFixContext(domain)) };
}

export async function connectWp(domainId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { org, domain, role } = await ownedDomain(domainId);
  requireManager(role);
  const limited = limitFor(org.id, "wp-connect", 10, 10);
  if (limited) return { error: limited, values: keep(formData) };
  const siteUrl = String(formData.get("siteUrl") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const appPassword = String(formData.get("appPassword") ?? "").trim();
  if (!siteUrl || !username || !appPassword) return { error: "Fill in the site address, username and application password.", values: keep(formData) };
  try {
    await connectWordPress(domain.id, { siteUrl, username, appPassword });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), values: keep(formData) };
  }
  revalidatePath(`/dashboard/fixes/${domain.id}`);
  return undefined;
}

export async function disconnectWp(domainId: string) {
  const { domain, role } = await ownedDomain(domainId);
  requireManager(role);
  await db.wpConnection.deleteMany({ where: { domainId: domain.id } });
  revalidatePath(`/dashboard/fixes/${domain.id}`);
}

// The proposal is rebuilt on the server from the latest audit; the browser only sends which one and any edited text.
export async function applyProposedFix(domainId: string, key: string, _: FormState, formData: FormData): Promise<FormState> {
  const { org, domain, proposals } = await fixContext(domainId);
  const limited = limitFor(org.id, "fix", 60, 10);
  if (limited) return { error: limited };
  if (!planForOrg(org).autoFix) return { error: "Automatic fixes aren't included in your plan." };
  const proposal = proposals.find((p) => p.key === key);
  if (!proposal) return { error: "This fix is no longer suggested by the latest audit. Re-run the audit." };
  const text = proposal.editableText ? String(formData.get("text") ?? "") : undefined;
  if (proposal.editableText && text !== undefined && text.trim().length < 20) return { error: "Write a description of at least 20 characters." };
  try {
    const fix = await applyFix(org.id, domain.id, proposal, text);
    revalidatePath(`/dashboard/fixes/${domain.id}`);
    return fix.status === "failed" ? { error: fix.error ?? "The site rejected the fix." } : undefined;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function ownedFix(fixId: string) {
  const { org } = await requireUser();
  const fix = await db.fix.findFirst({ where: { id: fixId, orgId: org.id } });
  if (!fix) throw new Error("Fix not found");
  if (limitFor(org.id, "fix", 60, 10)) throw new Error("Too many fix actions. Try again in a few minutes.");
  return fix;
}

export async function recheckFix(fixId: string) {
  const fix = await ownedFix(fixId);
  await verifyFix(fix.id);
  revalidatePath(`/dashboard/fixes/${fix.domainId}`);
}

export async function rollbackAppliedFix(fixId: string) {
  const fix = await ownedFix(fixId);
  await rollbackFix(fix.id);
  revalidatePath(`/dashboard/fixes/${fix.domainId}`);
}

// Links in emails and payment return URLs. In production this must come from APP_URL, never the request's Host
// header, which a client controls.
async function appBaseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") throw new Error("Set APP_URL to the app's public address.");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export async function startCheckout(planId: string) {
  const { org, user, role } = await requireUser();
  requireManager(role);
  const plan = PLANS[planId as PlanId];
  if (!plan || plan.id === "trial") throw new Error("Unknown plan");
  if ((plan.id === "agency") !== (org.kind === "agency")) throw new Error("This plan isn't available for this workspace");
  const clients = plan.id === "agency" ? await db.organization.count({ where: { parentId: org.id } }) : 1;
  const url = await createCheckout(org, plan, user.email, await appBaseUrl(), clients);
  redirect(url);
}

export async function openBillingPortal() {
  const { org, role } = await requireUser();
  requireManager(role);
  if (!org.stripeCustomerId) throw new Error("No billing account yet");
  redirect(await createPortal(org.stripeCustomerId, await appBaseUrl()));
}

export async function saveFacts(domainId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { org, domain } = await ownedDomain(domainId);
  const limited = limitFor(org.id, "facts", 30, 10);
  if (limited) return { error: limited, values: keep(formData) };
  const parsed = parseFactsForm(formData);
  if (!parsed.success) return { error: parsed.error, values: keep(formData) };
  const data = JSON.stringify(parsed.data);
  await db.factsRecord.upsert({ where: { domainId: domain.id }, update: { data }, create: { domainId: domain.id, data } });
  // Re-check the latest stored answers right away; this reads saved text only and makes no AI calls.
  const run = await db.visibilityRun.findFirst({ where: { domainId: domain.id, status: "completed", results: { some: { error: null } } }, orderBy: { createdAt: "desc" } });
  if (run) await truthCheck(run.id, { alert: false });
  revalidatePath(`/dashboard/truth/${domain.id}`);
  return undefined;
}

export async function setCategory(domainId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { domain } = await ownedDomain(domainId);
  const category = String(formData.get("category") ?? "").trim().slice(0, 80) || null;
  await db.domain.update({ where: { id: domain.id }, data: { category } });
  revalidatePath(`/dashboard/visibility/${domain.id}`);
  return undefined;
}

const MAX_CSV_BYTES = 2 * 1024 * 1024;

export async function importGscQueries(domainId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { org, domain } = await ownedDomain(domainId);
  const limited = limitFor(org.id, "import", 20, 10);
  if (limited) return { error: limited };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the Queries.csv file from your Search Console export." };
  if (file.size > MAX_CSV_BYTES) return { error: "That file is over 2 MB. Export a shorter date range." };
  const { rows, error } = parseGscQueries(await file.text());
  if (error) return { error };
  await db.$transaction([db.gscQuery.deleteMany({ where: { domainId: domain.id } }), db.gscQuery.createMany({ data: rows.map((r) => ({ ...r, domainId: domain.id })) })]);
  revalidatePath(`/dashboard/visibility/${domain.id}`);
  return undefined;
}

export async function importSearchDays(domainId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { org, domain } = await ownedDomain(domainId);
  const limited = limitFor(org.id, "import", 20, 10);
  if (limited) return { error: limited };
  const source = String(formData.get("source") ?? "");
  if (!(source in SEARCH_SOURCES)) return { error: "Pick which report this file is." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the Dates.csv (or Bing export) file." };
  if (file.size > MAX_CSV_BYTES) return { error: "That file is over 2 MB." };
  const { days, error } = parseDailyCsv(await file.text());
  if (error) return { error };
  await db.$transaction([
    db.searchDay.deleteMany({ where: { domainId: domain.id, source } }),
    db.searchDay.createMany({ data: days.map((d) => ({ domainId: domain.id, source, ...d })) }),
  ]);
  revalidatePath(`/dashboard/attribution/${domain.id}`);
  return undefined;
}

// Paid and opt-in: the form must carry the user's explicit confirmation, and the plan quota must cover every page.
export async function startJudgeRun(crawlId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { org } = await requireUser();
  if (formData.get("confirm") !== "yes") return { error: "Tick the box to confirm you want to use your Anthropic API key for this check." };
  if (!process.env.ANTHROPIC_API_KEY) return { error: "Add ANTHROPIC_API_KEY to .env to run this check." };
  const crawl = await db.crawl.findFirst({ where: { id: crawlId, orgId: org.id, status: "completed" }, include: { pages: true, domain: { include: { prompts: true } } } });
  if (!crawl) return { error: "Audit not found." };
  if (await db.judgeRun.findFirst({ where: { crawlId, status: { in: ["queued", "running"] } } })) return { error: "A check is already running for this audit." };
  const targets = judgeTargets(crawl.pages, crawl.domain.prompts.map((p) => p.text));
  if (!targets.length) return { error: "No content pages with enough text to check." };
  const quota = await checkAnswerQuota(org, targets.length);
  if (quota) return { error: quota };
  const model = judgeModel();
  const run = await db.judgeRun.create({
    data: { crawlId, orgId: org.id, model, estimateMicros: estimateMicros(model, targets.map((t) => t.chars)), results: { create: targets.map((t) => ({ url: t.url, question: t.question })) } },
  });
  await enqueueJob(org.id, "judge", { judgeRunId: run.id });
  revalidatePath(`/dashboard/crawls/${crawlId}`);
  return undefined;
}

export async function addClient(_: FormState, formData: FormData): Promise<FormState> {
  const { org, role } = await requireUser();
  requireManager(role);
  const limited = limitFor(org.id, "add-client", 30, 60);
  if (limited) return { error: limited };
  if (org.kind !== "agency") return { error: "Only agency workspaces can add clients." };
  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  if (name.length < 2) return { error: "Enter the client's name." };
  const plan = planForOrg(org);
  const count = await db.organization.count({ where: { parentId: org.id } });
  if (count >= (plan.maxClients ?? 0)) {
    return { error: `Your ${plan.name} plan includes ${plan.maxClients} client workspaces. Upgrade to the Agency plan on the Billing page to add more.` };
  }
  await createClientWorkspace(org.id, name);
  try {
    await syncAgencySeats(org, count + 1);
  } catch (err) {
    // The client exists either way; a failed seat update is retried the next time clients change.
    console.error("[billing] seat sync failed:", err);
  }
  revalidatePath("/dashboard/clients");
  return undefined;
}

// Switching only re-issues the session after checking the user may act in the target workspace.
export async function switchWorkspace(orgId: string) {
  const { user } = await requireUser();
  const target = await resolveAccess(user.id, orgId);
  if (!target) throw new Error("Workspace not found");
  const current = await readSession();
  await createSession({ userId: user.id, orgId }, current?.sid);
  redirect(target.org.kind === "agency" ? "/dashboard/clients" : "/dashboard");
}

export async function saveBranding(_: FormState, formData: FormData): Promise<FormState> {
  const { org, role } = await requireUser();
  requireManager(role);
  if (org.kind !== "agency") return { error: "Branding is available to agency workspaces.", values: keep(formData) };
  const parsed = brandingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message, values: keep(formData) };
  await db.organization.update({ where: { id: org.id }, data: parsed.data });
  revalidatePath("/dashboard", "layout");
  return undefined;
}

export type NewKeyState = { error?: string; key?: string } | undefined;

export async function createKey(_: NewKeyState, formData: FormData): Promise<NewKeyState> {
  const { org, role } = await requireUser();
  requireManager(role);
  const limited = limitFor(org.id, "create-key", 10, 60);
  if (limited) return { error: limited };
  if (!planForOrg(org).api) return { error: "API access is included in the Advanced and Agency plans." };
  if ((await db.apiKey.count({ where: { orgId: org.id, revokedAt: null } })) >= 10) return { error: "Revoke an unused key first (limit 10)." };
  const { key } = await createApiKey(org.id, String(formData.get("name") ?? "").trim());
  revalidatePath("/dashboard/api");
  return { key };
}

export async function revokeKey(keyId: string) {
  const { org, role } = await requireUser();
  requireManager(role);
  await db.apiKey.updateMany({ where: { id: keyId, orgId: org.id, revokedAt: null }, data: { revokedAt: new Date() } });
  revalidatePath("/dashboard/api");
}

export async function addStaffNote(orgId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { user } = await requireUser();
  if (!isStaff(user)) throw new Error("Not found");
  if (!(await db.organization.findUnique({ where: { id: orgId } }))) throw new Error("Not found");
  const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
  if (!body) return { error: "Write a note first." };
  await db.staffNote.create({ data: { orgId, author: user.email, body } });
  revalidatePath(`/staff/${orgId}`);
  return undefined;
}

export async function resendVerification() {
  const { user } = await requireUser();
  if (user.emailVerifiedAt) return;
  if (!rateLimit(`verify-resend:${user.id}`, 3, 60 * 60_000).ok) throw new Error("Too many emails sent. Try again in an hour.");
  await sendVerificationEmail(user, await appBaseUrl());
}

export async function saveNotifications(_: FormState, formData: FormData): Promise<FormState> {
  const { org, role } = await requireUser();
  requireManager(role);
  const schedule = String(formData.get("reportSchedule") ?? "off");
  if (!(SCHEDULES as readonly string[]).includes(schedule)) return { error: "Pick a report schedule.", values: keep(formData) };
  const { emails, bad } = parseRecipients(String(formData.get("reportRecipients") ?? ""));
  if (bad.length) return { error: `Not a valid email address: ${bad[0]}`, values: keep(formData) };
  await db.organization.update({
    where: { id: org.id },
    data: {
      alertEmails: formData.get("alertEmails") === "on",
      reportSchedule: schedule,
      reportRecipients: emails.join(", ") || null,
      nextReportAt: schedule === org.reportSchedule && org.nextReportAt ? org.nextReportAt : nextRun(schedule, new Date()),
    },
  });
  revalidatePath("/dashboard/notifications");
  return undefined;
}

export async function sendTestReport(): Promise<FormState> {
  const { org, role } = await requireUser();
  requireManager(role);
  const limited = limitFor(org.id, "test-report", 3, 60);
  if (limited) return { error: limited };
  const sent = await sendReport(org.id);
  return sent ? { error: undefined, values: { sent: "yes" } } : { error: "No recipients yet: confirm your email or add report recipients." };
}
