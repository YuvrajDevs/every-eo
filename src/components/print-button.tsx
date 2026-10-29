"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded-full bg-accent px-5 py-2.5 text-xs font-medium text-accent-ink hover:opacity-85 print:hidden">
      Print / save as PDF
    </button>
  );
}
