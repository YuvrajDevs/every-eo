import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { markAlertsRead } from "@/app/actions";
import { Card } from "@/components/ui";

const KIND_LABEL: Record<string, string> = { visibility_drop: "AI visibility", bot_blocked: "Crawler access", new_issue: "Site audit" };

export default async function AlertsPage() {
  const { org } = await requireUser();
  const alerts = await db.alert.findMany({ where: { orgId: org.id }, orderBy: { createdAt: "desc" }, take: 100, include: { domain: true } });
  const unread = alerts.filter((a) => !a.readAt).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl sm:text-5xl">Alerts</h1>
          <p className="mt-2 text-xs text-muted">
            Raised when a scheduled or manual check finds something worse than the previous one. AI visibility alerts only fire when the drop is larger than normal answer-to-answer variation.
          </p>
        </div>
        {unread > 0 && (
          <form action={markAlertsRead}>
            <button className="rounded-full border border-line bg-surface px-4 py-2 text-xs hover:border-ink">Mark all read</button>
          </form>
        )}
      </div>
      {alerts.length === 0 ? (
        <Card>
          <p className="font-semibold">No alerts yet.</p>
          <p className="mt-1 text-sm text-muted">Turn on automatic checks for a site on its AI visibility page to be told when something changes.</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id} className={`rounded-2xl p-4 ${a.readAt ? "bg-surface" : "bg-rose"}`}>
              <p className="text-[11px] text-muted">
                {KIND_LABEL[a.kind] ?? a.kind} · {a.domain.hostname} · {a.createdAt.toLocaleString()}
              </p>
              <p className="mt-1 font-semibold">{a.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink/75">{a.detail}</p>
              {a.link && (
                <Link href={a.link} className="mt-2 inline-block text-xs underline underline-offset-4">
                  Open
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
