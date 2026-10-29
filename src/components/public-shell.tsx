import Link from "next/link";
import { Logo } from "@/components/sidebar";
import { buttonClass } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-8">
        <Link href="/" aria-label={`${APP_NAME} home`}>
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/audit" className="hidden rounded-full px-4 py-2.5 text-muted hover:text-ink sm:inline-flex">
            Free audit
          </Link>
          <Link href="/login" className="rounded-full px-3 py-2.5 text-muted hover:text-ink sm:px-4">
            Log in
          </Link>
          <Link href="/signup" className={buttonClass}>
            Get started
          </Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-8">{children}</main>
      <footer className="mx-auto mt-16 w-full max-w-6xl border-t border-line px-4 py-8 text-xs text-muted sm:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row">
          <p>
            {APP_NAME} checks how your site shows up in Google and in AI answers from ChatGPT, Claude, Gemini and Perplexity.
          </p>
          <nav className="flex gap-4">
            <Link href="/audit" className="hover:text-ink">Free audit</Link>
            <Link href="/signup" className="hover:text-ink">Sign up</Link>
            <Link href="/login" className="hover:text-ink">Log in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
