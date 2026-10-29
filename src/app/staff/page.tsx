import { requireStaff } from "@/lib/staff-auth";
import Link from "next/link";
import { db } from "@/lib/db";
import { workspaceOverview } from "@/lib/staff";
import { Card, SectionTitle } from "@/components/ui";

const usd = (m: number) => `$${(m / 1_000_000).toFixed(2)}`;

export default async function StaffHome() {
  await requireStaff();
  const rows = await workspaceOverview();
  const jobs = await db.job.groupBy({ by: ["status"], _count: { _all: true } });
  const totalCost = rows.reduce((s, r) => s + r.costMicros, 0);
  const flagged = rows.filter((r) => r.attention.length);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Workspaces", rows.length],
          ["Need attention", flagged.length],
          ["API cost this month", usd(totalCost)],
          ["Jobs queued / running / failed", ["queued", "running", "failed"].map((s) => jobs.find((j) => j.status === s)?._count._all ?? 0).join(" / ")],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <p className="font-display text-3xl">{value}</p>
            <p className="mt-1 text-xs text-muted">{label}</p>
          </Card>
        ))}
      </div>
      <Card>
        <SectionTitle>All workspaces</SectionTitle>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                {["Workspace", "Plan", "Sites", "AI answers (month)", "API cost (month)", "Failed jobs (7d)", "Unread alerts", "Attention"].map((h) => (
                  <th key={h} className="px-2 pb-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="px-2 py-2.5">
                    <Link href={`/staff/${r.id}`} className="font-semibold underline-offset-4 hover:underline">
                      {r.name}
                    </Link>
                    <p className="text-[11px] text-muted">
                      {r.kind}
                      {r.agency ? ` of ${r.agency}` : ""}
                      {r.kind === "agency" ? ` · ${r.clients} clients` : ""}
                    </p>
                  </td>
                  <td className="px-2 py-2.5">
                    {r.plan}
                    {r.planStatus ? <span className="block text-[11px] text-muted">{r.planStatus}</span> : null}
                  </td>
                  <td className="px-2 py-2.5 tabular-nums">{r.sites}</td>
                  <td className="px-2 py-2.5 tabular-nums">
                    {r.answers.toLocaleString()} / {r.answerQuota.toLocaleString()}
                  </td>
                  <td className="px-2 py-2.5 tabular-nums">{usd(r.costMicros)}</td>
                  <td className={`px-2 py-2.5 tabular-nums ${r.failedJobs7d ? "text-high" : ""}`}>{r.failedJobs7d}</td>
                  <td className="px-2 py-2.5 tabular-nums">{r.unreadAlerts}</td>
                  <td className="px-2 py-2.5 text-xs">{r.attention.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
