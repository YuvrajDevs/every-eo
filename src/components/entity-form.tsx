"use client";

import { useActionState } from "react";
import { saveEntity, type FormState } from "@/app/actions";
import type { EntityProfile } from "@/lib/entity";

const input = "w-full rounded-2xl border border-line bg-panel px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-ink";

function Field({ label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold">{label}</span>
      <input {...props} className={input} />
      {hint && <span className="block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

function Area({ label, hint, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold">{label}</span>
      <textarea {...props} className={`${input} min-h-20`} />
      {hint && <span className="block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function EntityForm({ domainId, entity }: { domainId: string; entity: EntityProfile }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveEntity.bind(null, domainId), undefined);
  const slots = [...entity.authors, null];
  // After a failed save, show exactly what was submitted instead of the last saved profile.
  const sv = state?.values;
  const val = (name: string, saved: string) => (sv ? (sv[name] ?? "") : saved);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Brand name" name="name" defaultValue={val("name", entity.name)} required />
        <Field label="Legal name" name="legalName" defaultValue={val("legalName", entity.legalName ?? "")} />
        <Field label="Website" name="url" defaultValue={val("url", entity.url)} required />
        <Field label="Logo URL" name="logo" defaultValue={val("logo", entity.logo ?? "")} placeholder="https://…/logo.png" />
        <Field label="Founded" name="foundingDate" defaultValue={val("foundingDate", entity.foundingDate ?? "")} placeholder="2019 or 2019-04" />
        <Field label="Support email" name="email" type="email" defaultValue={val("email", entity.email ?? "")} />
        <Field label="Phone" name="telephone" defaultValue={val("telephone", entity.telephone ?? "")} />
      </div>
      <Area label="What you do, in one sentence" name="description" defaultValue={val("description", entity.description ?? "")} maxLength={500} />
      <Area
        label="Profiles elsewhere (one per line)"
        name="sameAs"
        defaultValue={val("sameAs", entity.sameAs.join("\n"))}
        hint="LinkedIn, Crunchbase, Wikidata, G2, Capterra, X, YouTube… These become sameAs links that tell engines all these profiles are the same company."
      />
      <div className="space-y-3">
        <p className="font-display text-xl">Authors</p>
        {slots.map((a, i) => (
          <fieldset key={i} className="space-y-3 rounded-2xl border border-line p-4">
            <legend className="px-1 text-xs text-muted">{a ? a.name : "Add an author"}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" name={`author.${i}.name`} defaultValue={val(`author.${i}.name`, a?.name ?? "")} />
              <Field label="Role / credentials" name={`author.${i}.jobTitle`} defaultValue={val(`author.${i}.jobTitle`, a?.jobTitle ?? "")} placeholder="e.g. Certified financial planner" />
              <Field label="Author page URL" name={`author.${i}.url`} defaultValue={val(`author.${i}.url`, a?.url ?? "")} />
              <Field label="Photo URL" name={`author.${i}.image`} defaultValue={val(`author.${i}.image`, a?.image ?? "")} />
            </div>
            <Area label="Short bio" name={`author.${i}.bio`} defaultValue={val(`author.${i}.bio`, a?.bio ?? "")} maxLength={1000} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Area label="Topics (comma or one per line)" name={`author.${i}.knowsAbout`} defaultValue={val(`author.${i}.knowsAbout`, a?.knowsAbout.join(", ") ?? "")} />
              <Area label="Their profiles (one per line)" name={`author.${i}.sameAs`} defaultValue={val(`author.${i}.sameAs`, a?.sameAs.join("\n") ?? "")} />
            </div>
          </fieldset>
        ))}
        <p className="text-[11px] text-muted">To remove an author, clear their name and save.</p>
      </div>
      <button disabled={pending} className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-accent-ink hover:opacity-85 disabled:opacity-50">
        {pending ? "Saving…" : "Save and generate"}
      </button>
      {state?.error && (
        <p role="alert" className="text-xs text-high">
          {state.error}
        </p>
      )}
    </form>
  );
}
