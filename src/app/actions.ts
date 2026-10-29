"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { createSession, destroySession } from "@/lib/session";
import { nextRun, SCHEDULES, startCrawl, startVisibility } from "@/lib/jobs";
import { parseEntityForm } from "@/lib/entity-form";
import { loadFixContext } from "@/lib/fix-context";
import { parseFactsForm } from "@/lib/truth-form";
import { truthCheck } from "@/worker/truth";
import { planFor, PLANS, type PlanId } from "@/lib/plans";
import { createCheckout, createPortal } from "@/lib/stripe";
import { applyFix, connectWordPress, rollbackFix, verifyFix } from "@/lib/fix-engine";
import { normalizeHostname, UnsafeUrlError } from "@/lib/url-safety";

export type FormState = { error?: string } | undefined;

const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  company: z.string().trim().min(1, "Enter your company or agency name").max(100),
  email: z.email("Enter a valid email").trim().toLowerCase(),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

export async function signup(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, company, email, password } = parsed.data;

  if (await db.user.findUnique({ where: { email } })) {
    return { error: "An account with this email already exists. Log in instead." };
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const { user, org } = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: company } });
    const user = await tx.user.create({ data: { name, email, passwordHash } });
    await tx.membership.create({ data: { userId: user.id, orgId: org.id, role: "owner" } });
    return { user, org };
  });
  await createSession({ userId: user.id, orgId: org.id });
  redirect("/dashboard");
}

const loginSchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password"),
});

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  const ok = user && (await bcrypt.compare(parsed.data.password, user.passwordHash));
  if (!ok || user.memberships.length === 0) return { error: "Email or password is incorrect." };
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
  const plan = planFor(org.plan);
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
  const domain = await db.domain.findFirst({ where: { id: domainId, orgId: org.id } });
  if (!domain) throw new Error("Domain not found");
  const crawlId = await startCrawlFor(org.id, domain.id);
  redirect(`/dashboard/crawls/${crawlId}`);
}

async function ownedDomain(domainId: string) {
  const { org } = await requireUser();
  const domain = await db.domain.findFirst({ where: { id: domainId, orgId: org.id } });
  if (!domain) throw new Error("Domain not found");
  return { org, domain };
}

export async function addPrompt(domainId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { org, domain } = await ownedDomain(domainId);
  const MAX_PROMPTS = planFor(org.plan).promptsPerSite;
  const text = String(formData.get("text") ?? "").trim().replace(/\s+/g, " ");
  if (text.length < 5) return { error: "Write the question the way a customer would ask it." };
  if (text.length > 300) return { error: "Keep questions under 300 characters." };
  const count = await db.prompt.count({ where: { domainId: domain.id } });
  if (count >= MAX_PROMPTS) return { error: `You can track up to ${MAX_PROMPTS} questions per site on your plan.` };
  await db.prompt.create({ data: { domainId: domain.id, text } });
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
  const allowed = planFor(org.plan).schedules as string[];
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
  if (!parsed.success) return { error: parsed.error.issues[0].message };
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
  const { domain } = await ownedDomain(domainId);
  const siteUrl = String(formData.get("siteUrl") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const appPassword = String(formData.get("appPassword") ?? "").trim();
  if (!siteUrl || !username || !appPassword) return { error: "Fill in the site address, username and application password." };
  try {
    await connectWordPress(domain.id, { siteUrl, username, appPassword });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath(`/dashboard/fixes/${domain.id}`);
  return undefined;
}

export async function disconnectWp(domainId: string) {
  const { domain } = await ownedDomain(domainId);
  await db.wpConnection.deleteMany({ where: { domainId: domain.id } });
  revalidatePath(`/dashboard/fixes/${domain.id}`);
}

// The proposal is rebuilt on the server from the latest audit; the browser only sends which one and any edited text.
export async function applyProposedFix(domainId: string, key: string, _: FormState, formData: FormData): Promise<FormState> {
  const { org, domain, proposals } = await fixContext(domainId);
  if (!planFor(org.plan).autoFix) return { error: "Automatic fixes aren't included in your plan." };
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

async function appBaseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export async function startCheckout(planId: string) {
  const { org, user } = await requireUser();
  const plan = PLANS[planId as PlanId];
  if (!plan || plan.id === "trial") throw new Error("Unknown plan");
  const url = await createCheckout(org, plan, user.email, await appBaseUrl());
  redirect(url);
}

export async function openBillingPortal() {
  const { org } = await requireUser();
  if (!org.stripeCustomerId) throw new Error("No billing account yet");
  redirect(await createPortal(org.stripeCustomerId, await appBaseUrl()));
}

export async function saveFacts(domainId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { domain } = await ownedDomain(domainId);
  const parsed = parseFactsForm(formData);
  if (!parsed.success) return { error: parsed.error };
  const data = JSON.stringify(parsed.data);
  await db.factsRecord.upsert({ where: { domainId: domain.id }, update: { data }, create: { domainId: domain.id, data } });
  // Re-check the latest stored answers right away; this reads saved text only and makes no AI calls.
  const run = await db.visibilityRun.findFirst({ where: { domainId: domain.id, status: "completed" }, orderBy: { createdAt: "desc" } });
  if (run) await truthCheck(run.id, { alert: false });
  revalidatePath(`/dashboard/truth/${domain.id}`);
  return undefined;
}
