"use client";

import { useActionState } from "react";
import { createKey, type NewKeyState } from "@/app/actions";
import { CopyBlock } from "@/components/copy-block";

export function ApiKeyForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<NewKeyState, FormData>(createKey, undefined);
  return (
    <div className="space-y-3">
      <form action={action} className="flex gap-2">
        <input name="name" placeholder="Key name, e.g. Reporting dashboard" aria-label="Key name" disabled={!enabled} className="min-w-0 flex-1 rounded-full border border-line bg-panel px-4 py-2.5 text-sm outline-none focus:border-ink" />
        <button disabled={pending || !enabled} className="shrink-0 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-85 disabled:opacity-40">
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>
      {state?.error && (
        <p role="alert" className="text-xs text-high">
          {state.error}
        </p>
      )}
      {state?.key && (
        <div className="rounded-2xl bg-mint p-3">
          <CopyBlock label="Your new key. Copy it now; it won't be shown again." code={state.key} />
        </div>
      )}
    </div>
  );
}
