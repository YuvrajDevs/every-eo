"use client";

import { useActionState } from "react";
import { saveNotifications, sendTestReport, type FormState } from "@/app/actions";

const select = "rounded-full border border-line bg-panel px-3 py-2 text-sm outline-none";

export function NotificationsForm({ values }: { values: { alertEmails: boolean; reportSchedule: string; reportRecipients: string } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveNotifications, undefined);
  const [testState, testAction, testing] = useActionState<FormState, FormData>(sendTestReport, undefined);
  const v = state?.values;
  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="alertEmails" defaultChecked={v ? v.alertEmails === "on" : values.alertEmails} className="mt-1" />
          <span>
            Email alerts as they happen
            <span className="block text-xs text-muted">Grouped into one email per batch, sent to everyone in this workspace with a confirmed email.</span>
          </span>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>Summary report</span>
          <select name="reportSchedule" defaultValue={v?.reportSchedule ?? values.reportSchedule} className={select} aria-label="Report schedule">
            <option value="off">Off</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span>Also send reports to (up to 10, comma-separated)</span>
          <textarea name="reportRecipients" defaultValue={v?.reportRecipients ?? values.reportRecipients} placeholder="client@example.com" className="min-h-16 w-full rounded-2xl border border-line bg-panel px-4 py-2.5 outline-none focus:border-ink" />
        </label>
        <button disabled={pending} className="rounded-full bg-ink px-5 py-2.5 font-medium text-accent-ink hover:opacity-85 disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        {state?.error && (
          <p role="alert" className="text-xs text-high">
            {state.error}
          </p>
        )}
      </form>
      <form action={testAction} className="space-y-2">
        <button disabled={testing} className="rounded-full border border-line px-4 py-2 text-xs hover:border-ink disabled:opacity-50">
          {testing ? "Sending…" : "Send a report now"}
        </button>
        {testState?.error && <p className="text-xs text-high">{testState.error}</p>}
        {testState?.values?.sent && <p className="text-xs text-ok">Report sent.</p>}
      </form>
    </div>
  );
}
