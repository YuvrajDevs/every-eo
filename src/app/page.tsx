import Link from "next/link";
import { ArrowRight, Bot, ListChecks, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/sidebar";
import { buttonClass, TONES, type Tone } from "@/components/ui";

const FEATURES: { title: string; body: string; tone: Tone; icon: typeof Bot }[] = [
  {
    title: "Can AI find you?",
    body: "We check whether ChatGPT, Claude, Perplexity, Gemini and Google's crawlers are allowed to read your site.",
    tone: "lavender",
    icon: Bot,
  },
  {
    title: "What's holding you back?",
    body: "Every page is audited for the technical and content issues that stop you ranking or being cited.",
    tone: "peach",
    icon: ListChecks,
  },
  {
    title: "How sure are we?",
    body: "Each fix is labelled by how strong the evidence is that it works. No fake promises.",
    tone: "mint",
    icon: ShieldCheck,
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-8">
      <header className="flex items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/login" className="rounded-full px-4 py-2.5 text-muted hover:text-ink">Log in</Link>
          <Link href="/signup" className={buttonClass}>Get started</Link>
        </nav>
      </header>

      <section className="py-16 sm:py-24">
        <h1 className="max-w-4xl font-display text-5xl leading-[1.3] sm:text-7xl sm:leading-[1.3]">
          Show up in Google <br className="hidden sm:block" />
          and in <span className="rounded-3xl bg-highlight box-decoration-clone px-3 text-on-highlight">AI answers.</span>
        </h1>
        <p className="mt-6 max-w-xl text-muted">
          Connect your website. We audit it for search engines and AI assistants, tell you exactly what to fix, and track whether it&apos;s working.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/signup" className={buttonClass}>
            Audit my site <ArrowRight className="size-4" />
          </Link>
          <Link href="/login" className="inline-flex items-center rounded-full border border-line bg-surface px-5 py-3 hover:border-ink">
            I have an account
          </Link>
        </div>
      </section>

      <section className="grid gap-3 pb-16 md:grid-cols-3">
        {FEATURES.map(({ title, body, tone, icon: Icon }, i) => (
          <div key={title} className={`flex min-h-[240px] flex-col justify-between rounded-3xl p-6 ${TONES[tone]}`}>
            <div className="flex items-start justify-between">
              <span className="grid size-11 place-items-center rounded-full bg-surface/80">
                <Icon className="size-5" strokeWidth={1.75} />
              </span>
              <span className="text-xs text-ink/50">0{i + 1}</span>
            </div>
            <div>
              <h2 className="font-display text-2xl">{title}</h2>
              <p className="mt-2 text-xs leading-relaxed text-ink/70">{body}</p>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
