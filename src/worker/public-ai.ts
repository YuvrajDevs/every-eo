import { db } from "@/lib/db";
import { engineInfo, engineModel, engineUsesWebSearch } from "@/lib/engines";
import { PUBLIC_AI_TRIALS, type PublicAiResult } from "@/lib/public-audit";
import { askEngine } from "@/worker/visibility/providers";
import { brandTerms, detect } from "@/worker/visibility/run";

// The free audit's AI teaser: ask Gemini the visitor's question a few times and count how often the site comes up.
export async function runPublicAi(publicAuditId: string) {
  const audit = await db.publicAudit.update({ where: { id: publicAuditId }, data: { aiStatus: "running" }, include: { crawl: true } });
  const gemini = engineInfo("gemini");
  if (!audit.question || !gemini || !process.env[gemini.envKey]) {
    await db.publicAudit.update({ where: { id: audit.id }, data: { aiStatus: "skipped" } });
    return;
  }

  const terms = brandTerms(audit.hostname, null);
  const excerpts: NonNullable<PublicAiResult["excerpts"]> = [];
  let cost = 0;
  let lastError = "";
  // One at a time: free keys have low per-minute limits.
  for (let i = 0; i < PUBLIC_AI_TRIALS; i++) {
    try {
      const res = await askEngine(gemini, audit.question);
      const { mentioned } = detect(res.answer, res.citations, audit.hostname, terms);
      cost += res.costMicros;
      excerpts.push({ mentioned, text: res.answer.replace(/\s+/g, " ").trim().slice(0, 600) });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (cost) {
    await db.apiCallLog.create({ data: { orgId: audit.crawl.orgId, provider: "gemini", operation: "public_audit_ai", units: excerpts.length, costMicros: cost } });
  }

  const result: PublicAiResult = {
    engine: "gemini",
    model: engineModel(gemini),
    webSearch: engineUsesWebSearch(gemini),
    mentioned: excerpts.filter((e) => e.mentioned).length,
    total: excerpts.length,
    excerpts,
  };
  if (excerpts.length === 0) {
    console.error(`[worker] public AI check failed: ${lastError}`);
    result.reason = "The AI engine didn't respond this time. Try again later.";
  }
  await db.publicAudit.update({
    where: { id: audit.id },
    data: { aiStatus: excerpts.length ? "done" : "failed", aiResult: JSON.stringify(result) },
  });
}
