"use client";

import { useActionState } from "react";
import { saveBranding, type FormState } from "@/app/actions";

const input = "w-full rounded-2xl border border-line bg-panel px-4 py-2.5 text-sm outline-none placeholder:text-muted/60 focus:border-ink";

export function BrandingForm({ values }: { values: { brandName: string; brandLogoUrl: string; brandColor: string; reportFooter: string } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveBranding, undefined);
  const v = { ...values, ...state?.values };
  return (
    <form action={action} className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs font-semibold">Brand name</span>
        <input name="brandName" defaultValue={v.brandName} placeholder="Your agency" className={input} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-semibold">Logo URL (https, square works best)</span>
        <input name="brandLogoUrl" defaultValue={v.brandLogoUrl} placeholder="https://youragency.com/logo.png" className={input} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-semibold">Accent colour</span>
        <input name="brandColor" defaultValue={v.brandColor} placeholder="#3366ff" className={input} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-semibold">Report footer</span>
        <textarea name="reportFooter" defaultValue={v.reportFooter} maxLength={300} placeholder="Prepared by Your Agency · hello@youragency.com" className={`${input} min-h-16`} />
      </label>
      <button disabled={pending} className="rounded-full bg-highlight px-5 py-2.5 text-sm font-medium text-on-highlight hover:opacity-85 disabled:opacity-50">
        {pending ? "Saving…" : "Save branding"}
      </button>
      <p className="text-[11px] text-muted">Leave the brand name empty to switch back to the standard branding.</p>
      {state?.error && (
        <p role="alert" className="text-xs text-high">
          {state.error}
        </p>
      )}
    </form>
  );
}
