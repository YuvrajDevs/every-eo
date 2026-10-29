import type { Metadata } from "next";
import { Bot, Gauge, ListChecks, MessageSquareQuote } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { PublicAuditForm } from "@/components/public-audit-form";
import { TONES, type Tone } from "@/components/ui";
import { PUBLIC_MAX_PAGES } from "@/lib/public-audit";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Free AI visibility audit · ${APP_NAME}`,
  description: "Check in a minute whether Google and AI assistants can read your site, what to fix first, and whether AI mentions you.",
};

const CHECKS: { title: string; body: string; tone: Tone; icon: typeof Bot }[] = [
  { title: "Can AI read your site?", body: "We test the crawlers behind ChatGPT, Claude, Perplexity and Google, including firewalls that block them.", tone: "lavender", icon: Bot },
  { title: "What to fix first", body: `We read up to ${PUBLIC_MAX_PAGES} pages and rank the issues that most hold you back.`, tone: "peach", icon: ListChecks },
  { title: "Does AI mention you?", body: "Add a question your customers ask and we ask Gemini three times.", tone: "mint", icon: MessageSquareQuote },
  { title: "One clear score", body: "A technical health score out of 100, with every fix graded by how strong the evidence is.", tone: "sky", icon: Gauge },
];

export default async function FreeAuditPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site } = await searchParams;
  return (
    <PublicShell>
      <section className="mx-auto max-w-3xl py-12 text-center sm:py-20">
        <p className="mx-auto w-fit rounded-full bg-lime px-3 py-1 text-xs font-medium">Free · no sign-up · about a minute</p>
        <h1 className="mt-5 font-display text-4xl sm:text-6xl">Is your site visible to AI?</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted">
          Enter your website. We check what Google and AI assistants see, show your top fixes, and test whether AI recommends you.
        </p>
        <div className="mx-auto mt-8 max-w-2xl text-left">
          <PublicAuditForm site={typeof site === "string" ? site.slice(0, 300) : ""} />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CHECKS.map(({ title, body, tone, icon: Icon }) => (
          <div key={title} className={`flex min-h-[190px] flex-col justify-between rounded-3xl p-5 ${TONES[tone]}`}>
            <span className="grid size-10 place-items-center rounded-full bg-white/70">
              <Icon className="size-5" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="font-display text-xl">{title}</h2>
              <p className="mt-1.5 text-sm text-ink/70">{body}</p>
            </div>
          </div>
        ))}
      </section>
    </PublicShell>
  );
}
