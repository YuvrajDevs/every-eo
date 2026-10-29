"use client";

import { useActionState } from "react";
import { Play, Plus } from "lucide-react";
import { MARKETS } from "@/lib/markets";
import { addPrompt, importGscQueries, setBrandName, setCategory, setSchedules, startVisibilityRun, type FormState } from "@/app/actions";

function ErrorText({ state }: { state: FormState }) {
  return state?.error ? (
    <p role="alert" className="mt-2 px-2 text-xs text-high">
      {state.error}
    </p>
  ) : null;
}

const pillInput =
  "min-w-0 flex-1 rounded-full border border-line bg-panel px-4 py-2.5 text-ink outline-none placeholder:text-muted/60 focus:border-ink";

export function AddPromptForm({ domainId }: { domainId: string }) {
  const [state, action, pending] = useActionState(addPrompt.bind(null, domainId), undefined);
  return (
    <form action={action}>
      <div className="flex gap-2">
        <input name="text" required placeholder="e.g. best games for couples to play online" aria-label="Question to track" className={pillInput} />
        <select name="market" aria-label="Market" defaultValue="" className="w-28 shrink-0 rounded-full border border-line bg-panel px-3 text-xs outline-none sm:w-40">
          <option value="">Any market</option>
          {MARKETS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button disabled={pending} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-85 disabled:opacity-50">
          <Plus className="size-4" /> Add
        </button>
      </div>
      <ErrorText state={state} />
    </form>
  );
}

export function BrandNameForm({ domainId, brandName }: { domainId: string; brandName: string | null }) {
  const [state, action, pending] = useActionState(setBrandName.bind(null, domainId), undefined);
  return (
    <form action={action}>
      <div className="flex gap-2">
        <input name="brandName" defaultValue={brandName ?? ""} placeholder="Brand name, e.g. Honest Mailbox" aria-label="Brand name" className={pillInput} />
        <button disabled={pending} className="shrink-0 rounded-full border border-line px-4 py-2.5 text-sm hover:border-ink disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <ErrorText state={state} />
    </form>
  );
}

export function RunCheckForm({
  domainId,
  promptCount,
  engineCount,
  disabled,
}: {
  domainId: string;
  promptCount: number;
  engineCount: number;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(startVisibilityRun.bind(null, domainId), undefined);
  return (
    <form action={action}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 rounded-full bg-panel px-4 py-2.5 text-sm">
          <span className="text-muted">Ask each question</span>
          <select name="trials" defaultValue="5" className="bg-transparent font-semibold outline-none">
            <option value="3">3 times</option>
            <option value="5">5 times</option>
            <option value="10">10 times</option>
          </select>
        </label>
        <button
          disabled={pending || disabled}
          className="inline-flex items-center gap-2 rounded-full bg-highlight px-5 py-2.5 font-medium text-on-highlight hover:opacity-85 disabled:opacity-40"
        >
          <Play className="size-4" /> {pending ? "Starting…" : "Run check"}
        </button>
      </div>
      <p className="mt-2 px-2 text-xs text-muted">
        {promptCount} {promptCount === 1 ? "question" : "questions"} × {engineCount} {engineCount === 1 ? "engine" : "engines"} × the number of times you pick. More repeats give a tighter range.
      </p>
      <ErrorText state={state} />
    </form>
  );
}

export function ScheduleForm({
  domainId,
  auditSchedule,
  visibilitySchedule,
  visibilityTrials,
  nextAuditAt,
  nextVisibilityAt,
}: {
  domainId: string;
  auditSchedule: string;
  visibilitySchedule: string;
  visibilityTrials: number;
  nextAuditAt: string | null;
  nextVisibilityAt: string | null;
}) {
  const [state, action, pending] = useActionState(setSchedules.bind(null, domainId), undefined);
  const select = "rounded-full border border-line bg-panel px-3 py-2 text-sm outline-none";
  const options = (
    <>
      <option value="off">Off</option>
      <option value="weekly">Weekly</option>
      <option value="monthly">Monthly</option>
    </>
  );
  return (
    <form action={action} className="space-y-3 text-sm">
      <label className="flex items-center justify-between gap-3">
        <span>Site audit</span>
        <select name="auditSchedule" defaultValue={auditSchedule} className={select} aria-label="Site audit schedule">{options}</select>
      </label>
      {nextAuditAt && <p className="-mt-2 text-[11px] text-muted">Next: {nextAuditAt}</p>}
      <label className="flex items-center justify-between gap-3">
        <span>AI answer check</span>
        <select name="visibilitySchedule" defaultValue={visibilitySchedule} className={select} aria-label="AI answer check schedule">{options}</select>
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="text-muted">Repeats per question</span>
        <select name="visibilityTrials" defaultValue={String(visibilityTrials)} className={select} aria-label="Repeats per question">
          <option value="3">3</option>
          <option value="5">5</option>
          <option value="10">10</option>
        </select>
      </label>
      {nextVisibilityAt && <p className="-mt-2 text-[11px] text-muted">Next: {nextVisibilityAt}</p>}
      <p className="text-[11px] text-muted">Scheduled AI checks use your API keys and cost money each time; see Costs for the per-run estimate.</p>
      <button disabled={pending} className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink disabled:opacity-50">
        {pending ? "Saving…" : "Save schedule"}
      </button>
      <ErrorText state={state} />
    </form>
  );
}

export function TrackSuggestionForm({ domainId, text }: { domainId: string; text: string }) {
  const [state, action, pending] = useActionState(addPrompt.bind(null, domainId), undefined);
  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="text" value={text} />
      <button disabled={pending} className="rounded-full border border-line px-3 py-1 text-[11px] hover:border-ink disabled:opacity-50" aria-label={`Track "${text}"`}>
        {pending ? "Adding…" : "Track"}
      </button>
      {state?.error && <span className="ml-2 text-[11px] text-high">{state.error}</span>}
    </form>
  );
}

export function CategoryForm({ domainId, category }: { domainId: string; category: string | null }) {
  const [state, action, pending] = useActionState(setCategory.bind(null, domainId), undefined);
  return (
    <form action={action}>
      <div className="flex gap-2">
        <input name="category" defaultValue={category ?? ""} placeholder="What you are, e.g. mail scanning service" aria-label="Business category" className={pillInput} />
        <button disabled={pending} className="shrink-0 rounded-full border border-line px-4 py-2.5 text-sm hover:border-ink disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <ErrorText state={state} />
    </form>
  );
}

export function GscImportForm({ domainId }: { domainId: string }) {
  const [state, action, pending] = useActionState(importGscQueries.bind(null, domainId), undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="file" name="file" accept=".csv,text/csv" aria-label="Search Console Queries CSV" className="block w-full text-xs file:mr-3 file:rounded-full file:border file:border-line file:bg-panel file:px-3 file:py-1.5" />
      <button disabled={pending} className="rounded-full border border-line px-4 py-2 text-xs hover:border-ink disabled:opacity-50">
        {pending ? "Importing…" : "Import queries"}
      </button>
      <ErrorText state={state} />
    </form>
  );
}
