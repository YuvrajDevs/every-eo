"use client";

import { useActionState } from "react";
import { startJudgeRun, type FormState } from "@/app/actions";

export function JudgeForm({ crawlId, pages, estimate, model, enabled }: { crawlId: string; pages: number; estimate: string; model: string; enabled: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(startJudgeRun.bind(null, crawlId), undefined);
  return (
    <form action={action} className="space-y-2 text-sm">
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" name="confirm" value="yes" className="mt-0.5" disabled={!enabled} />
        <span>
          Use my Anthropic API key to check {pages} pages with {model}. Estimated cost about {estimate}; counts {pages} answers toward this month&apos;s quota.
        </span>
      </label>
      <button disabled={pending || !enabled} className="rounded-full border border-line px-4 py-2 text-xs hover:border-ink disabled:opacity-40">
        {pending ? "Starting…" : "Run AI extractability check"}
      </button>
      {!enabled && <p className="text-[11px] text-muted">Add ANTHROPIC_API_KEY to .env to enable this check.</p>}
      {state?.error && (
        <p role="alert" className="text-xs text-high">
          {state.error}
        </p>
      )}
    </form>
  );
}
