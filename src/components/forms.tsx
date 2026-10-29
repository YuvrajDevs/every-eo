"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { addDomainAndCrawl, login, signup, type FormState } from "@/app/actions";
import { buttonClass, inputClass } from "@/components/ui";

function ErrorText({ state, dark = false }: { state: FormState; dark?: boolean }) {
  return state?.error ? (
    <p role="alert" className={`px-2 text-xs ${dark ? "text-rose" : "text-high"}`}>
      {state.error}
    </p>
  ) : null;
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-2 text-xs text-muted">{label}</span>
      <input {...props} className={inputClass} />
    </label>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" name="name" autoComplete="name" required />
        <Field label="Company or agency" name="company" autoComplete="organization" required />
      </div>
      <Field label="Work email" name="email" type="email" autoComplete="email" required />
      <Field label="Password" name="password" type="password" placeholder="At least 10 characters" autoComplete="new-password" required minLength={10} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="agency" value="yes" className="mt-1" />
        <span>
          I&apos;m an agency managing several clients
          <span className="block text-xs text-muted">You get a client console and can brand reports as your own.</span>
        </span>
      </label>
      <ErrorText state={state} />
      <button disabled={pending} className={`${buttonClass} w-full`}>
        {pending ? "Creating account…" : "Create account"}
        {!pending && <ArrowRight className="size-4" />}
      </button>
      <p className="text-center text-xs text-muted">
        Already have an account? <Link href="/login" className="font-semibold text-ink underline underline-offset-4">Log in</Link>
      </p>
    </form>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <ErrorText state={state} />
      <button disabled={pending} className={`${buttonClass} w-full`}>
        {pending ? "Logging in…" : "Log in"}
        {!pending && <ArrowRight className="size-4" />}
      </button>
      <p className="text-center text-xs text-muted">
        New here? <Link href="/signup" className="font-semibold text-ink underline underline-offset-4">Create an account</Link>
      </p>
    </form>
  );
}

export function AddDomainForm({ variant = "light" }: { variant?: "light" | "dark" }) {
  const [state, action, pending] = useActionState(addDomainAndCrawl, undefined);
  const dark = variant === "dark";
  return (
    <form action={action} className="space-y-2">
      <div className={`flex items-center gap-2 rounded-full p-1.5 ${dark ? "bg-surface" : "border border-line bg-surface"}`}>
        <input
          name="domain"
          placeholder="yourwebsite.com"
          required
          aria-label="Website domain"
          className="min-w-0 flex-1 bg-transparent px-4 py-2 text-ink outline-none placeholder:text-muted"
        />
        <button
          disabled={pending}
          className={`inline-flex shrink-0 items-center gap-2 rounded-full px-5 py-2.5 font-medium transition hover:opacity-85 disabled:opacity-50 ${
            dark ? "bg-highlight text-on-highlight" : "bg-ink text-accent-ink"
          }`}
        >
          {pending ? "Starting…" : "Run audit"}
          {!pending && <ArrowRight className="size-4" />}
        </button>
      </div>
      <ErrorText state={state} dark={dark} />
    </form>
  );
}
