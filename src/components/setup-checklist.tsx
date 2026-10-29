import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { db } from "@/lib/db";

// A short "get started" list for new workspaces. It disappears once every step is done.
export async function SetupChecklist({ orgId, emailVerified }: { orgId: string; emailVerified: boolean }) {
  const [firstDomain, audits, prompts, aiRuns, brand] = await Promise.all([
    db.domain.findFirst({ where: { orgId }, orderBy: { createdAt: "asc" }, select: { id: true } }),
    db.crawl.count({ where: { orgId, status: "completed" } }),
    db.prompt.count({ where: { domain: { orgId } } }),
    db.visibilityRun.count({ where: { orgId, status: "completed" } }),
    db.domain.count({ where: { orgId, brandName: { not: null } } }),
  ]);
  const visibilityHref = firstDomain ? `/dashboard/visibility/${firstDomain.id}` : "/dashboard/visibility";

  const steps = [
    { done: Boolean(firstDomain), label: "Add your website", hint: "Paste your domain in the box above.", href: null },
    { done: audits > 0, label: "Get your first audit", hint: "It runs on its own once a site is added.", href: "/dashboard/sites" },
    { done: brand > 0 && prompts > 0, label: "Tell us your brand and customer questions", hint: "So we know what to look for in AI answers.", href: visibilityHref },
    { done: aiRuns > 0, label: "Check what AI says about you", hint: "Run your first AI visibility check.", href: visibilityHref },
    { done: emailVerified, label: "Confirm your email", hint: "Needed for alerts and reports.", href: null },
  ];
  const completed = steps.filter((s) => s.done).length;
  if (completed === steps.length) return null;

  return (
    <section className="rounded-3xl bg-surface p-5 sm:p-6">
      <div className="flex items-end justify-between gap-4">
        <h2 className="font-display text-2xl">Get started</h2>
        <p className="text-sm text-muted">
          {completed} of {steps.length} done
        </p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-ok" style={{ width: `${(completed / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((s) => {
          const body = (
            <>
              {s.done ? <CheckCircle2 className="size-5 shrink-0 text-ok" /> : <Circle className="size-5 shrink-0 text-muted/60" />}
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${s.done ? "text-muted line-through" : ""}`}>{s.label}</span>
                {!s.done && <span className="block text-xs text-muted">{s.hint}</span>}
              </span>
            </>
          );
          return (
            <li key={s.label}>
              {s.href && !s.done ? (
                <Link href={s.href} className="flex h-full items-start gap-3 rounded-2xl bg-panel p-3 transition hover:ring-1 hover:ring-line">
                  {body}
                </Link>
              ) : (
                <div className="flex h-full items-start gap-3 rounded-2xl bg-panel p-3">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
