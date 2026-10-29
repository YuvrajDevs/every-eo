"use client";

import { useActionState } from "react";
import { addClient, type FormState } from "@/app/actions";

export function AddClientForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addClient, undefined);
  return (
    <form action={action} className="space-y-2">
      <div className="flex gap-2">
        <input name="name" placeholder="Client name" aria-label="Client name" className="min-w-0 flex-1 rounded-full border border-line bg-panel px-4 py-2.5 text-sm outline-none focus:border-ink" />
        <button disabled={pending} className="shrink-0 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-85 disabled:opacity-50">
          {pending ? "Adding…" : "Add client"}
        </button>
      </div>
      {state?.error && (
        <p role="alert" className="text-xs text-high">
          {state.error}
        </p>
      )}
    </form>
  );
}
