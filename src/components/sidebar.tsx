"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Building2, Code2, CreditCard, Globe, LayoutGrid, LogOut, Mail, Palette, Radar, Receipt } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { logout } from "@/app/actions";
import { APP_NAME } from "@/lib/brand";

type NavItem = { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean };

const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid, match: (p) => p === "/dashboard" },
  { href: "/dashboard/sites", label: "Websites", icon: Globe, match: (p) => p.startsWith("/dashboard/sites") || p.startsWith("/dashboard/crawls") || p.startsWith("/dashboard/fixes") || p.startsWith("/dashboard/entity") },
  {
    href: "/dashboard/visibility",
    label: "AI visibility",
    icon: Radar,
    match: (p) => ["/dashboard/visibility", "/dashboard/competitors", "/dashboard/truth", "/dashboard/presence", "/dashboard/attribution"].some((x) => p.startsWith(x)),
  },
  { href: "/dashboard/alerts", label: "Alerts", icon: Bell, match: (p) => p.startsWith("/dashboard/alerts") },
];

const SECONDARY: NavItem[] = [
  { href: "/dashboard/notifications", label: "Email reports", icon: Mail, match: (p) => p.startsWith("/dashboard/notifications") },
  { href: "/dashboard/costs", label: "Costs", icon: Receipt, match: (p) => p.startsWith("/dashboard/costs") },
  { href: "/dashboard/api", label: "API", icon: Code2, match: (p) => p.startsWith("/dashboard/api") },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard, match: (p) => p.startsWith("/dashboard/billing") },
];

export function LogoMark({ logoUrl = null, size = 36 }: { logoUrl?: string | null; size?: number }) {
  return logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- agency logos are arbitrary external URLs
    <img src={logoUrl} alt="" width={size} height={size} referrerPolicy="no-referrer" className="rounded-xl object-contain" style={{ width: size, height: size }} />
  ) : (
    <span className="grid place-items-center rounded-xl bg-highlight text-on-highlight" style={{ width: size, height: size }}>
      <Radar className="size-[18px]" strokeWidth={2.2} />
    </span>
  );
}

export function Logo({ name = APP_NAME, logoUrl = null }: { name?: string; logoUrl?: string | null }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark logoUrl={logoUrl} />
      <span className="truncate text-lg font-semibold tracking-[-0.02em]">{name}</span>
    </span>
  );
}

function RailLink({ item, active, badge }: { item: NavItem; active: boolean; badge?: number }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={`group relative grid size-11 place-items-center rounded-2xl transition-colors ${
        active ? "bg-panel text-ink" : "text-muted hover:bg-panel/60 hover:text-ink"
      }`}
    >
      <Icon className="size-[19px]" strokeWidth={1.75} />
      {active && <span className="absolute -left-[17px] h-5 w-[3px] rounded-r-full bg-highlight" />}
      {!!badge && (
        <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-high px-1 text-[10px] font-semibold leading-4 text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
      <span className="pointer-events-none absolute left-full z-20 ml-3 whitespace-nowrap rounded-lg bg-panel px-2.5 py-1.5 text-xs text-ink opacity-0 shadow-lg shadow-black/40 ring-1 ring-line transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {item.label}
      </span>
    </Link>
  );
}

export function Sidebar({
  userName,
  orgName,
  unreadAlerts = 0,
  isAgency = false,
  brandName,
  brandLogoUrl,
}: {
  userName: string;
  orgName: string;
  unreadAlerts?: number;
  isAgency?: boolean;
  brandName?: string;
  brandLogoUrl?: string | null;
}) {
  const pathname = usePathname();
  const primary: NavItem[] = isAgency
    ? [{ href: "/dashboard/clients", label: "Clients", icon: Building2, match: (p) => p.startsWith("/dashboard/clients") }, ...PRIMARY]
    : PRIMARY;
  const secondary: NavItem[] = isAgency
    ? [...SECONDARY, { href: "/dashboard/branding", label: "Branding", icon: Palette, match: (p) => p.startsWith("/dashboard/branding") }]
    : SECONDARY;
  const all = [...primary, ...secondary];
  const initials = userName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      {/* Desktop: slim icon rail */}
      <aside className="sticky top-0 hidden h-screen w-[76px] shrink-0 flex-col items-center gap-2 py-5 lg:flex" aria-label="Main">
        <Link href="/dashboard" aria-label={`${brandName ?? APP_NAME} overview`} className="group relative mb-5">
          <LogoMark logoUrl={brandLogoUrl} size={38} />
          <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-panel px-2.5 py-1.5 text-xs font-medium text-ink opacity-0 shadow-lg shadow-black/40 ring-1 ring-line transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {brandName ?? APP_NAME}
          </span>
        </Link>
        <nav className="flex flex-col items-center gap-1.5">
          {primary.map((item) => (
            <RailLink key={item.href} item={item} active={item.match(pathname)} badge={item.href === "/dashboard/alerts" ? unreadAlerts : 0} />
          ))}
        </nav>
        <span className="my-3 h-px w-7 bg-line" />
        <nav className="flex flex-col items-center gap-1.5" aria-label="Account">
          {secondary.map((item) => (
            <RailLink key={item.href} item={item} active={item.match(pathname)} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-3">
          <span title={`${userName} · ${orgName}`} className="grid size-10 place-items-center rounded-full bg-panel text-xs font-semibold ring-1 ring-line">
            {initials}
          </span>
          <form action={logout}>
            <button aria-label="Log out" title="Log out" className="grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-panel hover:text-ink">
              <LogOut className="size-[18px]" strokeWidth={1.75} />
            </button>
          </form>
        </div>
      </aside>

      {/* Phone and tablet: top bar with a scrollable section switcher */}
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/dashboard">
            <Logo name={brandName} logoUrl={brandLogoUrl} />
          </Link>
          <form action={logout}>
            <button aria-label="Log out" className="grid size-10 place-items-center rounded-full text-muted hover:bg-panel hover:text-ink">
              <LogOut className="size-[18px]" strokeWidth={1.75} />
            </button>
          </form>
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none]" aria-label="Main">
          {all.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-xs transition-colors ${active ? "bg-ink text-accent-ink" : "bg-surface text-muted"}`}
              >
                <Icon className="size-4" strokeWidth={1.75} />
                {label}
                {href === "/dashboard/alerts" && unreadAlerts > 0 && <span className="rounded-full bg-high px-1.5 text-[10px] text-white">{unreadAlerts}</span>}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
