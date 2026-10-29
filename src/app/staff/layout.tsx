import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { isStaff } from "@/lib/staff";

// Internal only. Non-staff get a plain 404 so the route's existence isn't confirmed.
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  if (!isStaff(user.email)) notFound();
  return (
    <main className="min-h-screen px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/staff" className="font-display text-2xl">
            Account success
          </Link>
          <span className="rounded-full bg-rose px-3 py-1 text-xs">Internal · {user.email}</span>
        </div>
        {children}
      </div>
    </main>
  );
}
