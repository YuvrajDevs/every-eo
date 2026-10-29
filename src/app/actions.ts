"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { createSession, destroySession } from "@/lib/session";
import { nextRun, SCHEDULES, startCrawl, startVisibility } from "@/lib/jobs";
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

const MAX_PROMPTS = 15;

export async function addPrompt(domainId: string, _: FormState, formData: FormData): Promise<FormState> {
  const { domain } = await ownedDomain(domainId);
  const text = String(formData.get("text") ?? "").trim().replace(/\s+/g, " ");
  if (text.length < 5) return { error: "Write the question the way a customer would ask it." };
  if (text.length > 300) return { error: "Keep questions under 300 characters." };
  const count = await db.prompt.count({ where: { domainId: domain.id } });
  if (count >= MAX_PROMPTS) return { error: `You can track up to ${MAX_PROMPTS} questions per site for now.` };
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
  const { domain } = await ownedDomain(domainId);
  const pick = (key: string) => {
    const v = String(formData.get(key) ?? "off");
    return (SCHEDULES as readonly string[]).includes(v) ? v : "off";
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
