import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { db } from "@/lib/db";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, org } = await requireUser();
  const unreadAlerts = await db.alert.count({ where: { orgId: org.id, readAt: null } });
  return (
    <div className="min-h-screen lg:flex">
      <Sidebar userName={user.name} orgName={org.name} unreadAlerts={unreadAlerts} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
