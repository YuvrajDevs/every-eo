"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bell, Building2, Globe, LayoutGrid, LogOut, Radar, Receipt, Settings, CreditCard } from "lucide-react";
import { logout } from "@/app/actions";
import { APP_NAME } from "@/lib/brand";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid, match: (p: string) => p === "/dashboard" },
  { href: "/dashboard/sites", label: "Websites", icon: Globe, match: (p: string) => p.startsWith("/dashboard/sites") || p.startsWith("/dashboard/crawls") },
  { href: "/dashboard/visibility", label: "AI visibility", icon: Radar, match: (p: string) => p.startsWith("/dashboard/visibility") },
  { href: "/dashboard/alerts", label: "Alerts", icon: Bell, match: (p: string) => p.startsWith("/dashboard/alerts") },
  { href: "/dashboard/costs", label: "Costs", icon: Receipt, match: (p: string) => p.startsWith("/dashboard/costs") },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard, match: (p: string) => p.startsWith("/dashboard/billing") },
];

const SOON = [
  { label: "Reports", icon: BarChart3 },
  { label: "Settings", icon: Settings },
];

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-highlight text-on-highlight">
        <Radar className="size-[18px]" strokeWidth={2} />
      </span>
      <span className="font-display text-xl">{APP_NAME}</span>
    </span>
  );
}

export function Sidebar({ userName, orgName, unreadAlerts = 0, isAgency = false }: { userName: string; orgName: string; unreadAlerts?: number; isAgency?: boolean }) {
  const nav = isAgency ? [{ href: "/dashboard/clients", label: "Clients", icon: Building2, match: (p: string) => p.startsWith("/dashboard/clients") }, ...NAV] : NAV;
  const pathname = usePathname();
  const initials = userName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      {/* Desktop */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-panel px-5 py-7 lg:flex">
        <Link href="/dashboard" className="px-2">
          <Logo />
        </Link>

        <nav className="mt-10 flex flex-col gap-1">
          {nav.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-3 rounded-2xl px-3 py-2.5 transition ${
                  active ? "bg-surface font-semibold text-ink" : "text-muted hover:bg-surface/60 hover:text-ink"
                }`}
              >
                {active && <span className="absolute -left-5 h-6 w-1 rounded-r-full bg-ink" />}
                <Icon className="size-[18px]" strokeWidth={1.75} />
                {label}
                {href === "/dashboard/alerts" && unreadAlerts > 0 && (
                  <span className="ml-auto rounded-full bg-high px-2 py-0.5 text-[10px] font-semibold text-white">{unreadAlerts}</span>
                )}
              </Link>
            );
          })}

          <p className="mt-6 mb-1 px-3 text-[11px] uppercase tracking-wider text-muted/80">Coming next</p>
          {SOON.map(({ label, icon: Icon }) => (
            <span key={label} className="flex cursor-default items-center gap-3 whitespace-nowrap rounded-2xl px-3 py-2.5 text-muted/60">
              <Icon className="size-[18px]" strokeWidth={1.75} />
              {label}
              <span className="ml-auto rounded-full bg-line px-2 py-0.5 text-[10px]">Soon</span>
            </span>
          ))}
        </nav>

        <div className="mt-auto flex items-center gap-3 rounded-2xl bg-surface p-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-lavender text-xs font-semibold">{initials}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{userName}</p>
            <p className="truncate text-xs text-muted">{orgName}</p>
          </div>
          <form action={logout}>
            <button aria-label="Log out" title="Log out" className="grid size-9 place-items-center rounded-full text-muted transition hover:bg-panel hover:text-ink">
              <LogOut className="size-4" strokeWidth={1.75} />
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile */}
      <header className="sticky top-0 z-10 border-b border-line bg-panel/95 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/dashboard"><Logo /></Link>
          <form action={logout}>
            <button aria-label="Log out" className="grid size-9 place-items-center rounded-full text-muted hover:text-ink">
              <LogOut className="size-4" strokeWidth={1.75} />
            </button>
          </form>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-4 pb-3">
          {nav.map(({ href, label, icon: Icon, match }) => (
            <Link
              key={href}
              href={href}
              className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs ${match(pathname) ? "bg-ink text-accent-ink" : "bg-surface text-muted"}`}
            >
              <Icon className="size-4" strokeWidth={1.75} />
              {label}
              {href === "/dashboard/alerts" && unreadAlerts > 0 && <span className="rounded-full bg-high px-1.5 text-[10px] text-white">{unreadAlerts}</span>}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
