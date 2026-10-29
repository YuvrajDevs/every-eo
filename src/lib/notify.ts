import { db } from "@/lib/db";
import { brandFor } from "@/lib/branding";
import { healthScore } from "@/lib/health";
import { nextRun } from "@/lib/jobs";
import { sendMail } from "@/lib/mailer";
import { pct, wilson } from "@/lib/stats";

const MAX_RECIPIENTS = 10;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export function parseRecipients(input: string) {
  const list = input
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const bad = list.filter((e) => !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(e));
  return { emails: [...new Set(list)].slice(0, MAX_RECIPIENTS), bad };
}

// Who hears about a workspace: its members with confirmed emails, the owning agency's (for client workspaces),
// plus any extra report recipients for reports.
async function recipients(orgId: string, includeExtra: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  const orgIds = [org.id, ...(org.kind === "client" && org.parentId ? [org.parentId] : [])];
  const members = await db.membership.findMany({ where: { orgId: { in: orgIds } }, include: { user: { select: { email: true, emailVerifiedAt: true } } } });
  const verified = members.filter((m) => m.user.emailVerifiedAt).map((m) => m.user.email.toLowerCase());
  const extra = includeExtra && org.reportRecipients ? parseRecipients(org.reportRecipients).emails : [];
  return [...new Set([...verified, ...extra])].slice(0, MAX_RECIPIENTS);
}

async function brandOf(orgId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, include: { parent: true } });
  return { org, brand: brandFor(org, org.parent) };
}

// Emails new alerts, grouped into one message per workspace. Each alert is emailed at most once.
export async function deliverAlerts() {
  const pending = await db.alert.findMany({ where: { emailedAt: null }, orderBy: { createdAt: "asc" }, take: 500, include: { domain: { select: { hostname: true } } } });
  const byOrg = new Map<string, typeof pending>();
  for (const a of pending) byOrg.set(a.orgId, [...(byOrg.get(a.orgId) ?? []), a]);
  let sent = 0;
  for (const [orgId, alerts] of byOrg) {
    const { org, brand } = await brandOf(orgId);
    const to = org.alertEmails ? await recipients(orgId, false) : [];
    if (to.length) {
      const lines = alerts.map((a) => `• ${a.title} (${a.domain.hostname})\n  ${a.detail.slice(0, 400)}${a.link ? `\n  ${appUrl()}${a.link}` : ""}`);
      const html = `<p>${alerts.length === 1 ? "A new alert" : `${alerts.length} new alerts`} for ${esc(org.name)}:</p><ul>${alerts
        .map((a) => `<li><strong>${esc(a.title)}</strong> <span style="color:#666">(${esc(a.domain.hostname)})</span><br>${esc(a.detail.slice(0, 400))}${a.link ? `<br><a href="${esc(appUrl() + a.link)}">Open</a>` : ""}</li>`)
        .join("")}</ul>`;
      await sendMail({
        to: to.join(", "),
        subject: alerts.length === 1 ? `${org.name}: ${alerts[0].title}` : `${org.name}: ${alerts.length} new alerts`,
        text: `${lines.join("\n\n")}\n\nManage emails in ${brand.name}: ${appUrl()}/dashboard/notifications`,
        html: `${html}<p style="color:#666;font-size:12px">Sent by ${esc(brand.name)}. <a href="${esc(appUrl())}/dashboard/notifications">Email settings</a></p>`,
        fromName: brand.name,
      });
      sent++;
    }
    // Marked even when nobody receives it (emails off / no confirmed address), so old alerts don't flood in later.
    await db.alert.updateMany({ where: { id: { in: alerts.map((a) => a.id) } }, data: { emailedAt: new Date() } });
  }
  return sent;
}

// Summary of every site in a workspace: latest audit health, AI mention rate (with range), unread alerts.
export async function buildReport(orgId: string) {
  const { org, brand } = await brandOf(orgId);
  const domains = await db.domain.findMany({
    where: { orgId },
    orderBy: { hostname: "asc" },
    include: {
      crawls: { where: { status: "completed" }, orderBy: { createdAt: "desc" }, take: 1, include: { findings: { select: { severity: true, fixability: true } } } },
      visibilityRuns: { where: { status: "completed", results: { some: { error: null } } }, orderBy: { createdAt: "desc" }, take: 1, include: { results: { select: { mentioned: true, error: true } } } },
      fixes: { where: { appliedAt: { gte: new Date(Date.now() - 31 * 86_400_000) } }, select: { id: true } },
    },
  });
  const unread = await db.alert.count({ where: { orgId, readAt: null } });
  const rows = domains.map((d) => {
    const ok = d.visibilityRuns[0]?.results.filter((r) => !r.error) ?? [];
    const ci = wilson(ok.filter((r) => r.mentioned).length, ok.length);
    return {
      site: d.hostname,
      health: d.crawls[0] ? healthScore(d.crawls[0].findings) : null,
      urgent: d.crawls[0]?.findings.filter((f) => f.severity === "high" && f.fixability !== "platform").length ?? 0,
      mention: ok.length ? `${pct(ci.rate)} (${pct(ci.low)}–${pct(ci.high)})` : "not checked",
      fixes: d.fixes.length,
    };
  });
  const text = [
    `${org.name}: visibility summary`,
    "",
    ...rows.map((r) => `${r.site}: health ${r.health ?? "—"}/100, ${r.urgent} urgent issues, mentioned in ${r.mention} of AI answers, ${r.fixes} fixes applied in the last month`),
    "",
    `${unread} unread alerts. Full details: ${appUrl()}/dashboard`,
    ...(brand.reportFooter ? ["", brand.reportFooter] : []),
  ].join("\n");
  const html = `<h2 style="font-family:sans-serif">${esc(org.name)}: visibility summary</h2><table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:14px"><tr style="text-align:left;color:#666"><th>Site</th><th>Health</th><th>Urgent</th><th>Mentioned in AI answers</th><th>Fixes (30d)</th></tr>${rows
    .map((r) => `<tr style="border-top:1px solid #ddd"><td>${esc(r.site)}</td><td>${r.health ?? "—"}</td><td>${r.urgent}</td><td>${esc(r.mention)}</td><td>${r.fixes}</td></tr>`)
    .join("")}</table><p style="font-family:sans-serif">${unread} unread alerts · <a href="${esc(appUrl())}/dashboard">Open the dashboard</a></p>${brand.reportFooter ? `<p style="color:#666;font-size:12px">${esc(brand.reportFooter)}</p>` : ""}`;
  return { subject: `${org.name}: visibility summary`, text, html, fromName: brand.name, rows };
}

export async function sendReport(orgId: string) {
  const to = await recipients(orgId, true);
  if (!to.length) return false;
  const r = await buildReport(orgId);
  await sendMail({ to: to.join(", "), subject: r.subject, text: r.text, html: r.html, fromName: r.fromName });
  return true;
}

// Sends reports that are due and moves each due date on (claimed first, so two workers never send twice).
export async function deliverDueReports(now = new Date()) {
  const due = await db.organization.findMany({ where: { reportSchedule: { not: "off" }, nextReportAt: { lte: now } } });
  let sent = 0;
  for (const o of due) {
    const claimed = await db.organization.updateMany({ where: { id: o.id, nextReportAt: o.nextReportAt }, data: { nextReportAt: nextRun(o.reportSchedule, now) } });
    if (claimed.count === 1 && (await sendReport(o.id))) sent++;
  }
  return sent;
}
