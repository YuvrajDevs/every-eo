"use client";

import { useActionState } from "react";
import { addStaffNote, type FormState } from "@/app/actions";

export function StaffNoteForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addStaffNote.bind(null, orgId), undefined);
  return (
    <form action={action} className="space-y-2">
      <textarea name="body" aria-label="Internal note" placeholder="Call notes, promises made, next steps…" className="min-h-20 w-full rounded-2xl border border-line bg-panel px-4 py-2.5 text-sm outline-none focus:border-ink" />
      <button disabled={pending} className="rounded-full bg-ink px-4 py-2 text-xs text-accent-ink disabled:opacity-50">
        {pending ? "Saving…" : "Add note"}
      </button>
      {state?.error && <p className="text-xs text-high">{state.error}</p>}
    </form>
  );
}
