import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { clientSummaries } from "@/lib/clients";
import { switchWorkspace } from "@/app/actions";
import { Card, SectionTitle } from "@/components/ui";
import { AddClientForm } from "@/components/client-forms";

export default async function ClientsPage() {
  const { org } = await requireUser();
  if (org.kind !== "agency") notFound();
  const clients = await clientSummaries(org.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl sm:text-5xl">Clients</h1>
        <p className="mt-2 text-xs text-muted">Every client gets its own workspace. Open one to audit, track and fix its sites; your team can switch between them.</p>
      </div>
      <Card>
        <SectionTitle>Add a client</SectionTitle>
        <AddClientForm />
      </Card>
      <Card>
        <SectionTitle>All clients · {clients.length}</SectionTitle>
        {clients.length === 0 ? (
          <p className="text-sm text-muted">No clients yet.</p>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="px-2 pb-2 font-normal">Client</th>
                  <th className="px-2 pb-2 text-right font-normal">Sites</th>
                  <th className="px-2 pb-2 text-right font-normal">Avg health</th>
                  <th className="px-2 pb-2 text-right font-normal">AI mention rate</th>
                  <th className="px-2 pb-2 text-right font-normal">Unread alerts</th>
                  <th className="px-2 pb-2 text-right font-normal">AI answers this month</th>
                  <th className="px-2 pb-2" />
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-2 py-3 font-semibold">{c.name}</td>
                    <td className="px-2 py-3 text-right tabular-nums">{c.sites}</td>
                    <td className="px-2 py-3 text-right tabular-nums">{c.health ?? "—"}</td>
                    <td className="px-2 py-3 text-right tabular-nums">{c.mentionRate === null ? "—" : `${Math.round(c.mentionRate * 100)}%`}</td>
                    <td className={`px-2 py-3 text-right tabular-nums ${c.unreadAlerts ? "text-high" : ""}`}>{c.unreadAlerts}</td>
                    <td className="px-2 py-3 text-right tabular-nums">{c.answersThisMonth.toLocaleString()}</td>
                    <td className="px-2 py-3 text-right">
                      <form action={switchWorkspace.bind(null, c.id)}>
                        <button className="rounded-full border border-line px-3 py-1 text-xs hover:border-ink">Open</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
