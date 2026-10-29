import { factsSchema, type BrandFacts } from "@/lib/truth";

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

// Prices are entered one per line as "Label | amount | currency" (currency optional, defaults to USD).
export function parseFactsForm(form: FormData) {
  const priceErrors: string[] = [];
  const prices = lines(form.get("prices")).flatMap((line) => {
    const [label, amount, currency] = line.split("|").map((s) => s.trim());
    const n = Number((amount ?? "").replace(/[^0-9.]/g, ""));
    if (!label || !amount || !Number.isFinite(n)) {
      priceErrors.push(line);
      return [];
    }
    return [{ label, amount: n, currency: (currency || "USD").toUpperCase() }];
  });
  if (priceErrors.length) return { success: false as const, error: `Couldn't read price line "${priceErrors[0]}". Use: Plan name | 29 | USD` };
  const year = String(form.get("foundedYear") ?? "").trim();
  const parsed = factsSchema.safeParse({
    prices,
    foundedYear: year ? Number(year) : undefined,
    discontinued: lines(form.get("discontinued")),
    competitors: lines(form.get("competitors")),
    claims: lines(form.get("claims")),
  });
  return parsed.success ? { success: true as const, data: parsed.data } : { success: false as const, error: parsed.error.issues[0].message };
}

export function factsToForm(f: BrandFacts | null) {
  return {
    prices: (f?.prices ?? []).map((p) => `${p.label} | ${p.amount} | ${p.currency}`).join("\n"),
    foundedYear: f?.foundedYear ? String(f.foundedYear) : "",
    discontinued: (f?.discontinued ?? []).join("\n"),
    competitors: (f?.competitors ?? []).join("\n"),
    claims: (f?.claims ?? []).join("\n"),
  };
}
