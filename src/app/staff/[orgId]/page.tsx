import { requireStaff } from "@/lib/staff-auth";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Card, SectionTitle } from "@/components/ui";
import { StaffNoteForm } from "@/components/staff-note-form";

export default async function StaffWorkspace({ params }: { params: Promise<{ orgId: string }> }) {
  await requireStaff();
  const { orgId } = await params;
  const org = await db.organization.findUnique({
    where: { id: orgId },
    include: {
      parent: true,
      memberships: { include: { user: { select: { email: true, name: true } } } },
      domains: { select: { hostname: true } },
      staffNotes: { orderBy: { createdAt: "desc" } },
      jobs: { where: { status: "failed" }, orderBy: { finishedAt: "desc" }, take: 20 },
      fixes: { where: { status: { in: ["failed", "not_visible"] } }, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!org) notFound();

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <Card>
          <SectionTitle>{org.name}</SectionTitle>
          <p className="text-sm">
            {org.kind}
            {org.parent ? ` of ${org.parent.name}` : ""} · plan {org.plan}
            {org.planStatus ? ` (${org.planStatus})` : ""} · created {org.createdAt.toLocaleDateString()}
          </p>
          <p className="mt-2 text-xs text-muted">Members: {org.memberships.map((m) => `${m.user.name} <${m.user.email}> (${m.role})`).join(", ") || "none (managed by agency)"}</p>
          <p className="mt-1 text-xs text-muted">Sites: {org.domains.map((d) => d.hostname).join(", ") || "none"}</p>
        </Card>
        <Card>
          <SectionTitle>Failed jobs</SectionTitle>
          {org.jobs.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {org.jobs.map((j) => (
                <li key={j.id} className="rounded-xl bg-panel p-3">
                  <span className="font-semibold">{j.type}</span> · {j.finishedAt?.toLocaleString()} · attempts {j.attempts}
                  <p className="mt-1 break-words text-muted">{j.error}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>Fixes needing help</SectionTitle>
          {org.fixes.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {org.fixes.map((f) => (
                <li key={f.id} className="rounded-xl bg-panel p-3">
                  <span className="font-semibold">{f.title}</span> · {f.status}
                  <p className="mt-1 text-muted">{f.error}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="h-fit">
        <SectionTitle>Internal notes</SectionTitle>
        <StaffNoteForm orgId={org.id} />
        <ul className="mt-4 space-y-2">
          {org.staffNotes.map((n) => (
            <li key={n.id} className="rounded-xl bg-panel p-3 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-[11px] text-muted">
                {n.author} · {n.createdAt.toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
