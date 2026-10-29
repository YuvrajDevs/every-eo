"use client";

import { useState } from "react";

export function CopyBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold">{label}</p>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded-full border border-line px-3 py-1 text-[11px] hover:border-ink"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto rounded-2xl bg-panel p-3 text-[11px] leading-relaxed"><code>{code}</code></pre>
    </div>
  );
}
