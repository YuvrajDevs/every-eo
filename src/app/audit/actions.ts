"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIpFrom } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeHostname, UnsafeUrlError } from "@/lib/url-safety";
import { createPublicAudit, PUBLIC_PER_IP_PER_HOUR } from "@/lib/public-audit";

export type PublicAuditState = { error?: string; values?: { site?: string; question?: string } } | undefined;

export async function startPublicAudit(_: PublicAuditState, formData: FormData): Promise<PublicAuditState> {
  const site = String(formData.get("site") ?? "").trim().slice(0, 300);
  const question = String(formData.get("question") ?? "").trim().replace(/\s+/g, " ");
  const values = { site, question };

  let hostname: string;
  try {
    hostname = normalizeHostname(site);
  } catch (err) {
    if (err instanceof UnsafeUrlError) return { error: err.message, values };
    throw err;
  }
  if (question && (question.length < 5 || question.length > 200)) {
    return { error: "Keep the question between 5 and 200 characters, or leave it empty.", values };
  }

  const ip = clientIpFrom(await headers());
  const limit = rateLimit(`public-audit:${ip}`, PUBLIC_PER_IP_PER_HOUR, 60 * 60_000);
  if (!limit.ok) {
    return { error: `You've run ${PUBLIC_PER_IP_PER_HOUR} free audits this hour. Create a free account to run more.`, values };
  }

  const audit = await createPublicAudit(hostname, question || null, ip);
  redirect(`/audit/${audit.id}`);
}
