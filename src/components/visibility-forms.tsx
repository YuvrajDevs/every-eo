"use client";

import { useActionState } from "react";
import { Play, Plus } from "lucide-react";
import { addPrompt, setBrandName, startVisibilityRun, type FormState } from "@/app/actions";

function ErrorText({ state }: { state: FormState }) {
  return state?.error ? (
    <p role="alert" className="mt-2 px-2 text-xs text-high">
      {state.error}
    </p>
  ) : null;
}

const pillInput =
  "min-w-0 flex-1 rounded-full border border-line bg-panel px-4 py-2.5 text-ink outline-none placeholder:text-muted focus:border-ink";

export function AddPromptForm({ domainId }: { domainId: string }) {
  const [state, action, pending] = useActionState(addPrompt.bind(null, domainId), undefined);
  return (
    <form action={action}>
      <div className="flex gap-2">
        <input name="text" required placeholder="e.g. best games for couples to play online" aria-label="Question to track" className={pillInput} />
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
