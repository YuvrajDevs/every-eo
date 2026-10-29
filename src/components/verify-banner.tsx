"use client";

import { useActionState } from "react";
import { resendVerification } from "@/app/actions";

export function VerifyBanner({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resendVerification, undefined);
  return (
    <form action={action} className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-peach px-4 py-2.5 text-xs">
      <span>Confirm your email address ({email}) using the link we sent you.</span>
      <span className="flex items-center gap-3">
        <span role="status" className={state?.error ? "text-high" : "text-ink/75"}>
          {state?.error ?? (state?.sent ? "Sent. Check your inbox." : "")}
        </span>
        <button disabled={pending} className="rounded-full bg-surface px-3 py-1 hover:opacity-85 disabled:opacity-50">
          {pending ? "Sending…" : "Send it again"}
        </button>
      </span>
    </form>
  );
}
