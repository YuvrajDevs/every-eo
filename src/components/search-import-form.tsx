"use client";

import { useActionState } from "react";
import { importSearchDays, type FormState } from "@/app/actions";

export function SearchImportForm({ domainId, sources }: { domainId: string; sources: Record<string, string> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(importSearchDays.bind(null, domainId), undefined);
  return (
    <form action={action} className="space-y-3 text-sm">
      <select name="source" aria-label="Which report" className="w-full rounded-full border border-line bg-panel px-4 py-2.5 outline-none">
        {Object.entries(sources).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <input type="file" name="file" accept=".csv,text/csv" aria-label="Daily performance CSV" className="block w-full text-xs file:mr-3 file:rounded-full file:border file:border-line file:bg-panel file:px-3 file:py-1.5" />
      <button disabled={pending} className="rounded-full border border-line px-4 py-2 text-xs hover:border-ink disabled:opacity-50">
        {pending ? "Importing…" : "Import"}
      </button>
      {state?.error && (
        <p role="alert" className="text-xs text-high">
          {state.error}
        </p>
      )}
    </form>
  );
}
