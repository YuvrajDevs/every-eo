"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { startPublicAudit } from "@/app/audit/actions";

export function PublicAuditForm({ site = "", compact = false }: { site?: string; compact?: boolean }) {
  const [state, action, pending] = useActionState(startPublicAudit, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-col gap-2 rounded-3xl bg-surface p-2 sm:flex-row sm:items-center sm:rounded-full">
        <input
          name="site"
          required
          defaultValue={state?.values?.site ?? site}
          placeholder="yourwebsite.com"
          aria-label="Website to audit"
          autoComplete="url"
          className="min-w-0 flex-1 rounded-full bg-transparent px-4 py-3 text-ink outline-none placeholder:text-muted/60"
        />
        <button
          disabled={pending}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-highlight px-6 py-3 font-medium text-on-highlight transition hover:opacity-85 disabled:opacity-50"
        >
          {pending ? "Starting…" : "Audit my site free"}
          {!pending && <ArrowRight className="size-4" />}
        </button>
      </div>
      {!compact && (
        <label className="block">
          <span className="mb-1.5 block px-2 text-sm">
            Optional: a question your customers ask AI
            <span className="block text-xs text-muted">We ask Gemini 3 times and tell you if it mentions your site.</span>
          </span>
          <input
            name="question"
            defaultValue={state?.values?.question}
            maxLength={200}
            placeholder="e.g. best games for couples to play online"
            aria-label="Question customers ask AI"
            className="w-full rounded-full border border-line bg-panel px-5 py-3 text-ink outline-none placeholder:text-muted/60 focus:border-ink"
          />
        </label>
      )}
      {state?.error && (
        <p role="alert" className="px-2 text-sm text-high">
          {state.error}
        </p>
      )}
    </form>
  );
}
