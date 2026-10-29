import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { db } from "@/lib/db";
import { switchWorkspace } from "@/app/actions";
import { VerifyBanner } from "@/components/verify-banner";
import { brandFor } from "@/lib/branding";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, org, agency } = await requireUser();
  const brand = brandFor(org, agency);
  // The agency's accent colour replaces ours for highlights, with readable text picked for it.
  const style = brand.color ? ({ "--highlight": brand.color, "--on-highlight": brand.onColor } as React.CSSProperties) : undefined;
  const unreadAlerts = await db.alert.count({ where: { orgId: org.id, readAt: null } });
  return (
    <div className="min-h-screen lg:flex" style={style}>
      <Sidebar userName={user.name} orgName={org.name} unreadAlerts={unreadAlerts} isAgency={org.kind === "agency"} brandName={brand.name} brandLogoUrl={brand.logoUrl} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-6xl">
          {!user.emailVerifiedAt && <VerifyBanner email={user.email} />}
          {agency && (
            <form action={switchWorkspace.bind(null, agency.id)} className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-lavender px-4 py-2.5 text-xs">
              <span>
                Client workspace: <strong>{org.name}</strong> · managed by {agency.name}
              </span>
              <button className="rounded-full bg-surface px-3 py-1 hover:opacity-85">Back to all clients</button>
            </form>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
