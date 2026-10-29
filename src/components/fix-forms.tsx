"use client";

import { useActionState } from "react";
import { applyProposedFix, connectWp, type FormState } from "@/app/actions";

const input = "w-full rounded-2xl border border-line bg-panel px-4 py-2.5 text-sm outline-none placeholder:text-muted/60 focus:border-ink";

function ErrorText({ state }: { state: FormState }) {
  return state?.error ? (
    <p role="alert" className="text-xs text-high">
      {state.error}
    </p>
  ) : null;
}

export function ConnectWpForm({ domainId, defaultUrl }: { domainId: string; defaultUrl: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(connectWp.bind(null, domainId), undefined);
  return (
    <form action={action} className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs font-semibold">Site address</span>
        <input name="siteUrl" defaultValue={state?.values?.siteUrl ?? defaultUrl} className={input} required />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-semibold">Admin username</span>
          <input name="username" defaultValue={state?.values?.username} className={input} autoComplete="off" required />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold">Application password</span>
          <input name="appPassword" type="password" className={input} autoComplete="new-password" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" required />
        </label>
      </div>
      <button disabled={pending} className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-accent-ink hover:opacity-85 disabled:opacity-50">
        {pending ? "Connecting…" : "Connect"}
      </button>
      <ErrorText state={state} />
    </form>
  );
}

export function ApplyFixForm({ domainId, fixKey, editableText, disabled }: { domainId: string; fixKey: string; editableText?: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(applyProposedFix.bind(null, domainId, fixKey), undefined);
  return (
    <form action={action} className="space-y-2">
      {editableText !== undefined && (
        <textarea name="text" defaultValue={editableText} maxLength={320} className={`${input} min-h-16`} aria-label="Meta description to apply" />
      )}
      <button disabled={pending || disabled} className="rounded-full bg-highlight px-4 py-2 text-xs font-medium text-on-highlight hover:opacity-85 disabled:opacity-40">
        {pending ? "Applying…" : "Apply to site"}
      </button>
      <ErrorText state={state} />
    </form>
  );
}
