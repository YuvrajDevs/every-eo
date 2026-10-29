import { db } from "@/lib/db";
import { engineInfo } from "@/lib/engines";
import { askEngine, type Citation } from "@/worker/visibility/providers";

const CONCURRENCY = 3;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Brand terms: the user-set brand name plus the domain's main label ("honestmailbox" from honestmailbox.com).
// Comparing with spaces and punctuation removed lets "Honest Mailbox" match "honestmailbox".
export function brandTerms(hostname: string, brandName: string | null) {
  const label = hostname.replace(/^www\./, "").split(".")[0];
  return [...new Set([brandName, label].filter((t): t is string => Boolean(t)).map(squash).filter((t) => t.length >= 3))];
}

export function detect(answer: string, citations: Citation[], hostname: string, terms: string[]) {
  const root = hostname.replace(/^www\./, "");
  const flat = squash(answer);
  const mentioned = terms.some((t) => flat.includes(t)) || answer.toLowerCase().includes(root);
  const cited = citations.some((c) => {
    try {
      const host = new URL(c.url).hostname.replace(/^www\./, "");
      if (host === root || host.endsWith(`.${root}`)) return true;
    } catch {
      // fall through to title check
    }
    return (c.title ?? "").toLowerCase().replace(/^www\./, "").includes(root);
  });
  return { mentioned: mentioned || cited, cited };
}

export async function runVisibility(runId: string) {
  const run = await db.visibilityRun.update({
    where: { id: runId },
    data: { status: "running", error: null },
    include: { domain: { include: { prompts: true } } },
  });
  await db.visibilityResult.deleteMany({ where: { runId } });

  const terms = brandTerms(run.domain.hostname, run.domain.brandName);
  const engines = run.engines.split(",").flatMap((id) => {
    const e = engineInfo(id);
    return e && process.env[e.envKey] ? [e] : [];
  });
  if (engines.length === 0) throw new Error("No AI engine API keys are configured.");

  const tasks = run.domain.prompts.flatMap((p) =>
    engines.flatMap((e) => Array.from({ length: run.trials }, (_, i) => ({ prompt: p, engine: e, trial: i + 1 }))),
  );

  let totalCost = 0;
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    await Promise.all(
      tasks.slice(i, i + CONCURRENCY).map(async ({ prompt, engine, trial }) => {
        try {
          const res = await askEngine(engine, prompt.text, prompt.market);
          const { mentioned, cited } = detect(res.answer, res.citations, run.domain.hostname, terms);
          totalCost += res.costMicros;
          await db.visibilityResult.create({
            data: {
              runId,
              promptId: prompt.id,
              engine: engine.id,
              trial,
              mentioned,
              cited,
              citedUrls: JSON.stringify(res.citations.slice(0, 20)),
              answer: res.answer.slice(0, 8000),
              costMicros: res.costMicros,
            },
          });
          await db.apiCallLog.create({
            data: { orgId: run.orgId, provider: engine.id, operation: "visibility_prompt", units: 1, costMicros: res.costMicros },
          });
        } catch (err) {
          await db.visibilityResult.create({
            data: { runId, promptId: prompt.id, engine: engine.id, trial, error: (err instanceof Error ? err.message : String(err)).slice(0, 500) },
          });
        }
      }),
    );
    await db.visibilityRun.update({ where: { id: runId }, data: { costMicros: totalCost } });
  }

  await db.visibilityRun.update({
    where: { id: runId },
    data: { status: "completed", costMicros: totalCost, finishedAt: new Date() },
  });
}
