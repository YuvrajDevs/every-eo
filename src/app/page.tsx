import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Building2,
  CheckCircle2,
  Gauge,
  ListChecks,
  MessageSquareQuote,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { PublicAuditForm } from "@/components/public-audit-form";
import { TONES, buttonClass, type Tone } from "@/components/ui";

const STEPS = [
  { n: "01", title: "Audit", body: "We read your site like Google and AI crawlers do, and list what stops you ranking or being recommended, most urgent first." },
  { n: "02", title: "Fix", body: "Apply fixes in a click on WordPress and Shopify, or follow step-by-step instructions for any other site builder." },
  { n: "03", title: "Track", body: "We ask ChatGPT, Claude, Gemini and Perplexity the questions your customers ask, and show how often they mention you." },
];

const FEATURES: { title: string; body: string; tone: Tone; icon: typeof Bot }[] = [
  { title: "AI crawler access", body: "See which AI crawlers can read your site, and catch firewalls that silently block them.", tone: "lavender", icon: Bot },
  { title: "Full technical audit", body: "Broken pages, titles, sitemaps, structured data, speed and how quotable each page is.", tone: "peach", icon: ListChecks },
  { title: "One-click fixes", body: "Structured data, descriptions and AI-crawler rules applied, checked on your live site, and reversible.", tone: "mint", icon: Wrench },
  { title: "AI mention tracking", body: "How often each AI engine mentions you, with an honest range instead of a made-up precise score.", tone: "sky", icon: MessageSquareQuote },
  { title: "Wrong-facts monitor", body: "Get told when AI states a wrong price or a discontinued product, or credits your claims to a competitor.", tone: "rose", icon: ShieldCheck },
  { title: "Competitors and trends", body: "Your share of AI mentions against competitors, who leads each question, and how it changes.", tone: "lime", icon: BarChart3 },
];

const DIFFERENT = [
  "We fix problems, not just report them.",
  "Every score comes with an honest range, because AI answers change every time you ask.",
  "Every recommendation says how strong the evidence is that it works.",
  "We use each AI company's official API, never scraping their apps.",
];

const FAQ = [
  {
    q: "What are AEO and GEO?",
    a: "SEO is about ranking in Google's results. AEO (answer engine optimization) is about appearing in AI answers like Google's AI Overviews. GEO (generative engine optimization) is about being recommended by assistants like ChatGPT, Claude, Gemini and Perplexity. We cover all three.",
  },
  {
    q: "Do I need to give you access to my website?",
    a: "No. The audit and AI tracking only read your public site. Access is needed only if you want us to apply fixes for you, through our WordPress plugin or Shopify app.",
  },
  {
    q: "Can you guarantee ChatGPT will recommend me?",
    a: "No one can. AI answers vary every time. We remove what blocks you, improve what evidence says helps, and measure honestly whether your mentions go up.",
  },
  {
    q: "Is it for agencies?",
    a: "Yes. Agencies get client workspaces, white-label reports with their own branding, per-client billing and an API.",
  },
];

export default function Home() {
  return (
    <PublicShell>
      <section className="grid items-center gap-10 py-12 sm:py-20 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="w-fit rounded-full bg-lime px-3 py-1 text-xs font-medium">SEO · AEO · GEO in one place</p>
          <h1 className="mt-5 font-display text-5xl leading-[1.08] sm:text-6xl">
            Get found on Google and <span className="rounded-2xl bg-highlight box-decoration-clone px-2 text-on-highlight">recommended by AI.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            We audit your site for search engines and AI assistants, fix what&apos;s holding you back, and track whether ChatGPT,
            Claude, Gemini and Perplexity mention you.
          </p>
          <div className="mt-8 max-w-xl">
            <PublicAuditForm compact />
            <p className="mt-2 px-2 text-xs text-muted">Free audit, no sign-up. Takes about a minute.</p>
          </div>
        </div>
        <SampleReport />
      </section>

      <section className="py-10">
        <h2 className="font-display text-3xl sm:text-4xl">How it works</h2>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-3xl bg-surface p-6">
              <p className="text-sm text-muted">{s.n}</p>
              <h3 className="mt-6 font-display text-2xl">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-10">
        <h2 className="font-display text-3xl sm:text-4xl">Everything you need to be visible</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ title, body, tone, icon: Icon }) => (
            <div key={title} className={`flex min-h-[200px] flex-col justify-between rounded-3xl p-6 ${TONES[tone]}`}>
              <span className="grid size-11 place-items-center rounded-full bg-white/70">
                <Icon className="size-5" strokeWidth={1.75} />
              </span>
              <div>
                <h3 className="font-display text-xl">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink/70">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 py-10 lg:grid-cols-2">
        <div className="rounded-[2rem] bg-dark p-8 text-on-dark">
          <h2 className="font-display text-3xl">Why we&apos;re different</h2>
          <ul className="mt-6 space-y-3">
            {DIFFERENT.map((d) => (
              <li key={d} className="flex gap-3 text-on-dark/85">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-highlight" />
                {d}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-between gap-6 rounded-[2rem] bg-lavender p-8">
          <div>
            <Building2 className="size-7" strokeWidth={1.5} />
            <h2 className="mt-4 font-display text-3xl">Built for agencies too</h2>
            <p className="mt-3 text-ink/75">
              Manage every client from one login, send reports under your own brand, and bill per client. Everything an
              AI-visibility agency does, automated.
            </p>
          </div>
          <Link href="/signup" className={`${buttonClass} w-fit`}>
            Start as an agency <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <section className="py-10">
        <div className="rounded-[2rem] bg-surface p-8 sm:p-10">
          <h2 className="font-display text-3xl sm:text-4xl">Pricing</h2>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <div className="rounded-3xl bg-panel p-6">
              <p className="font-display text-2xl">Free audit</p>
              <p className="mt-1 font-display text-4xl">$0</p>
              <p className="mt-3 text-sm text-muted">Health score, AI crawler access, your top fixes and a quick Gemini check. No account needed.</p>
              <Link href="/audit" className={`${buttonClass} mt-5`}>
                Audit my site <ArrowRight className="size-4" />
              </Link>
            </div>
            <div className="rounded-3xl bg-panel p-6">
              <p className="font-display text-2xl">Plans for businesses and agencies</p>
              <p className="mt-1 text-lg text-muted">Coming soon</p>
              <p className="mt-3 text-sm text-muted">
                Full audits, one-click fixes, AI tracking across four engines, alerts and white-label reports. Create a free
                account now and try everything on the trial.
              </p>
              <Link href="/signup" className="mt-5 inline-flex items-center gap-2 rounded-full border border-line px-5 py-3 hover:border-ink">
                Create free account
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-10">
        <h2 className="font-display text-3xl sm:text-4xl">Questions</h2>
        <div className="mt-6 space-y-2">
          {FAQ.map((f) => (
            <details key={f.q} className="group rounded-2xl bg-surface">
              <summary className="cursor-pointer list-none px-5 py-4 font-semibold">{f.q}</summary>
              <p className="px-5 pb-5 text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="py-10">
        <div className="rounded-[2rem] bg-highlight p-8 text-on-highlight sm:p-12">
          <h2 className="max-w-2xl font-display text-3xl sm:text-5xl">Find out what AI sees when it looks at your site.</h2>
          <div className="mt-8 max-w-xl">
            <PublicAuditForm compact />
          </div>
        </div>
      </section>
    </PublicShell>
  );
}

// Illustrative preview of a report, so visitors see what they get before running one.
function SampleReport() {
  const bots = [
    { name: "ChatGPT Search", ok: true },
    { name: "Claude search", ok: true },
    { name: "Perplexity search", ok: false },
    { name: "Google + AI Overviews", ok: true },
  ];
  return (
    <div className="space-y-3 rounded-[2rem] bg-surface p-4 sm:p-5" aria-label="Example report">
      <div className="flex items-center gap-4 rounded-3xl bg-dark p-5 text-on-dark">
        <div className="relative grid size-16 place-items-center rounded-full border-4 border-ok font-display text-xl">82</div>
        <div>
          <p className="font-display text-xl">Technical health</p>
          <p className="text-xs text-on-dark/65">2 urgent fixes would raise this the most.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl bg-rose p-4">
          <Gauge className="size-4" />
          <p className="mt-3 font-display text-3xl">2</p>
          <p className="text-xs text-ink/70">Urgent issues</p>
        </div>
        <div className="rounded-3xl bg-mint p-4">
          <MessageSquareQuote className="size-4" />
          <p className="mt-3 font-display text-3xl">40%</p>
          <p className="text-xs text-ink/70">AI answers mention you</p>
        </div>
      </div>
      <div className="rounded-3xl bg-panel p-4">
        <p className="mb-2 text-xs text-muted">Who can read your site</p>
        <ul className="space-y-1.5">
          {bots.map((b) => (
            <li key={b.name} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${b.ok ? "bg-ok" : "bg-high"}`} />
                {b.name}
              </span>
              <span className={`text-xs ${b.ok ? "text-ok" : "text-high"}`}>{b.ok ? "Allowed" : "Blocked"}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="px-2 text-center text-[11px] text-muted">Example report</p>
    </div>
  );
}
