import Link from "next/link";
import { Check } from "lucide-react";
import { Logo } from "@/components/sidebar";

const PREVIEW = [
  { engine: "ChatGPT Search", ok: true },
  { engine: "Claude search", ok: true },
  { engine: "Perplexity search", ok: false },
  { engine: "Google + AI Overviews", ok: true },
];

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <Link href="/" className="w-fit"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
          <h1 className="font-display text-4xl sm:text-5xl">{title}</h1>
          <p className="mt-2 mb-8 text-muted">{subtitle}</p>
          {children}
        </div>
      </div>

      <div className="hidden p-4 lg:block">
        <div className="flex h-full flex-col justify-between rounded-[2rem] bg-dark p-10 text-on-dark">
          <p className="font-display text-5xl leading-[1.25]">
            Find out if AI can even <span className="rounded-2xl bg-highlight px-3 text-on-highlight">see</span> your site.
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-3xl bg-lavender p-5 text-ink">
                <p className="font-display text-4xl">92</p>
                <p className="text-xs text-ink/70">Technical health</p>
              </div>
              <div className="rounded-3xl bg-peach p-5 text-ink">
                <p className="font-display text-4xl">2</p>
                <p className="text-xs text-ink/70">Urgent fixes</p>
              </div>
            </div>
            <div className="rounded-3xl bg-surface p-5 text-ink">
              <p className="mb-3 text-xs text-muted">Who can read your site</p>
              <ul className="space-y-2">
                {PREVIEW.map((p) => (
                  <li key={p.engine} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${p.ok ? "bg-ok" : "bg-high"}`} />
                      {p.engine}
                    </span>
                    <span className={p.ok ? "text-ok" : "text-high"}>{p.ok ? "Allowed" : "Blocked"}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="flex items-center gap-2 text-xs text-on-dark/60">
              <Check className="size-3.5" /> Example report. Yours takes about a minute.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
