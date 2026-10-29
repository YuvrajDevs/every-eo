import { db } from "@/lib/db";
import { checkAnswer, factsSchema, type Issue } from "@/lib/truth";
import { brandTerms } from "@/worker/visibility/run";

const LABEL: Record<Issue["kind"], string> = {
  price_mismatch: "states a wrong price",
  discontinued_as_current: "presents a discontinued product as current",
  wrong_founding_year: "gets your founding year wrong",
  stolen_claim: "credits your claim to someone else",
};

export async function loadFacts(domainId: string) {
  const rec = await db.factsRecord.findUnique({ where: { domainId } });
  if (!rec) return null;
  const parsed = factsSchema.safeParse(JSON.parse(rec.data));
  return parsed.success ? parsed.data : null;
}

// Scans a finished run's stored answers (no new AI calls). Re-running replaces that run's issues.
export async function truthCheck(runId: string, { alert = true } = {}) {
  const run = await db.visibilityRun.findUniqueOrThrow({ where: { id: runId }, include: { results: true, domain: true } });
  const facts = await loadFacts(run.domainId);
  await db.truthIssue.deleteMany({ where: { runId } });
  if (!facts) return 0;
  const terms = brandTerms(run.domain.hostname, run.domain.brandName);
  const brandHost = run.domain.hostname.replace(/^www\./, "");
  const rows = [];
  for (const r of run.results) {
    if (r.error || !r.answer) continue;
    const hosts = (r.citedUrls ? (JSON.parse(r.citedUrls) as { url: string }[]) : []).flatMap((c) => {
      try {
        return [new URL(c.url).hostname.replace(/^www\./, "")];
      } catch {
        return [];
      }
    });
    for (const i of checkAnswer(r.answer, terms, facts, hosts, brandHost)) {
      rows.push({ domainId: run.domainId, runId, resultId: r.id, engine: r.engine, promptId: r.promptId, kind: i.kind, sentence: i.sentence.slice(0, 600), detail: i.detail, credited: i.credited ?? null });
    }
  }
  if (rows.length) await db.truthIssue.createMany({ data: rows });
  if (alert && rows.length) {
    const byKind = new Map<string, typeof rows>();
    for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
    await db.alert.createMany({
      data: [...byKind].map(([kind, list]) => ({
        orgId: run.orgId,
        domainId: run.domainId,
        kind: kind === "stolen_claim" ? "stolen_claim" : "misinformation",
        title: `AI ${LABEL[kind as Issue["kind"]]} (${list.length} ${list.length === 1 ? "answer" : "answers"})`,
        detail: `Example: “${list[0].sentence.slice(0, 220)}” ${list[0].detail}`,
        link: `/dashboard/truth/${run.domainId}`,
      })),
    });
  }
  return rows.length;
}
