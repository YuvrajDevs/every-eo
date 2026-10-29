import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as cheerio from "cheerio";
import { db } from "@/lib/db";
import { safeFetch } from "@/lib/safe-fetch";
import { costMicros, judgeModel, judgePrompt, quoteOnPage, verdictSchema, type Verdict } from "@/lib/judge";

export type JudgeCall = (model: string, prompt: string) => Promise<{ verdict: Verdict; inputTokens: number; outputTokens: number }>;

export const askClaudeJudge: JudgeCall = async (model, prompt) => {
  const client = new Anthropic({ timeout: 120_000 });
  const res = await client.messages.parse({
    model,
    max_tokens: 2000,
    output_config: { format: zodOutputFormat(verdictSchema), effort: "low" },
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined to judge this page.");
  if (!res.parsed_output) throw new Error(`No verdict returned (stop reason: ${res.stop_reason}).`);
  return { verdict: res.parsed_output, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
};

export function pageText(html: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer, header, svg").remove();
  return ($("main").text() || $("body").text()).replace(/\s+/g, " ").trim();
}

// Runs once per user click. Every call is logged as a billable call; any single page failing doesn't stop the run.
export async function runJudge(judgeRunId: string, ask: JudgeCall = askClaudeJudge) {
  const run = await db.judgeRun.update({ where: { id: judgeRunId }, data: { status: "running" }, include: { results: true } });
  let total = 0;
  for (const r of run.results) {
    let text = "";
    try {
      text = pageText((await safeFetch(r.url)).body);
      const { verdict, inputTokens, outputTokens } = await ask(run.model, judgePrompt(r.question, text));
      const cost = costMicros(run.model, inputTokens, outputTokens);
      total += cost;
      const found = verdict.answerable && quoteOnPage(verdict.quote, text);
      await db.judgeResult.update({
        where: { id: r.id },
        data: {
          answerable: verdict.answerable,
          quoteFound: verdict.answerable ? found : null,
          // A quote the page doesn't contain means the verdict can't be trusted: score it as not answerable.
          score: verdict.answerable && !found ? 0 : verdict.score,
          quote: verdict.quote.slice(0, 600) || null,
          rationale: verdict.answerable && !found ? `The model's quote isn't on the page, so this verdict was discarded. ${verdict.rationale}` : verdict.rationale.slice(0, 500),
          costMicros: cost,
        },
      });
      await db.apiCallLog.create({ data: { orgId: run.orgId, provider: "anthropic", operation: "extractability_judge", units: 1, costMicros: cost } });
    } catch (err) {
      await db.judgeResult.update({ where: { id: r.id }, data: { error: (err instanceof Error ? err.message : String(err)).slice(0, 300) } });
    }
  }
  await db.judgeRun.update({ where: { id: run.id }, data: { status: "completed", costMicros: total, finishedAt: new Date() } });
}

export const defaultJudgeModel = judgeModel;
