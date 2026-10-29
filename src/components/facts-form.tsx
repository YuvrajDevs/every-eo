"use client";

import { useActionState } from "react";
import { saveFacts, type FormState } from "@/app/actions";

const area = "w-full min-h-24 rounded-2xl border border-line bg-panel px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-ink";

function Area({ label, hint, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold">{label}</span>
      <textarea {...props} className={area} />
      <span className="block text-[11px] text-muted">{hint}</span>
    </label>
  );
}

export function FactsForm({ domainId, values }: { domainId: string; values: Record<string, string> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveFacts.bind(null, domainId), undefined);
  return (
    <form action={action} className="space-y-4">
      <Area label="Current prices" name="prices" defaultValue={values.prices} placeholder={"Starter | 29 | USD\nPro | 79 | USD"} hint="One per line: name | amount | currency. Any other price an AI gives for you gets flagged." />
      <label className="block space-y-1">
        <span className="text-xs font-semibold">Year founded</span>
        <input name="foundedYear" defaultValue={values.foundedYear} inputMode="numeric" placeholder="2019" className="w-40 rounded-full border border-line bg-panel px-4 py-2.5 text-sm outline-none focus:border-ink" />
      </label>
      <Area label="Discontinued products or plans" name="discontinued" defaultValue={values.discontinued} placeholder="Basic plan" hint="One per line. Flagged when an answer mentions them without saying they're discontinued." />
      <Area label="Your distinctive claims and statistics" name="claims" defaultValue={values.claims} placeholder="We scan over 2 million letters a year" hint="One per line. Flagged when an answer repeats them without your name, or credits a competitor." />
      <Area label="Competitors" name="competitors" defaultValue={values.competitors} placeholder="Rival Mail" hint="One per line. Helps tell when your claims are credited to someone else." />
      <button disabled={pending} className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-accent-ink hover:opacity-85 disabled:opacity-50">
        {pending ? "Saving…" : "Save and re-check answers"}
      </button>
      {state?.error && (
        <p role="alert" className="text-xs text-high">
          {state.error}
        </p>
      )}
    </form>
  );
}
