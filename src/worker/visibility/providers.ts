import Anthropic from "@anthropic-ai/sdk";
import { engineModel, engineUsesWebSearch, type EngineInfo } from "@/lib/engines";
import { marketInfo } from "@/lib/markets";

export type Citation = { url: string; title: string | null };
export type EngineAnswer = { answer: string; citations: Citation[]; costMicros: number };

const TIMEOUT_MS = 120_000;

// Approximate list prices (USD per 1M tokens, per search) used only for cost estimates in the dashboard.
const PRICES: Record<string, { input: number; output: number; perSearch: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, perSearch: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, perSearch: 0.01 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, perSearch: 0.01 },
  "gpt-5-mini": { input: 0.25, output: 2, perSearch: 0.01 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, perSearch: 0.014 },
  "gemini-flash-latest": { input: 0.3, output: 2.5, perSearch: 0.014 },
  "gemini-3.1-flash-lite": { input: 0.1, output: 0.4, perSearch: 0.014 },
  sonar: { input: 1, output: 1, perSearch: 0.005 },
};

function estimate(model: string, input: number, output: number, searches: number) {
  const p = PRICES[model] ?? { input: 2, output: 10, perSearch: 0.01 };
  return Math.round((input * p.input + output * p.output) + searches * p.perSearch * 1_000_000);
}

const RETRY_DELAYS_MS = [5_000, 15_000];

// Retries only "temporarily overloaded" responses (502/503/504). Quota and auth errors fail straight away.
async function postJson<T>(url: string, headers: Record<string, string>, body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text) as T;
    if ([502, 503, 504].includes(res.status) && attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      continue;
    }
    throw new Error(`${res.status}: ${text.slice(0, 300)}`);
  }
}

async function askClaude(model: string, prompt: string, country?: string): Promise<EngineAnswer> {
  const client = new Anthropic({ timeout: TIMEOUT_MS });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  let input = 0;
  let output = 0;
  let searches = 0;
  const citations: Citation[] = [];
  const textParts: string[] = [];

  // Server-side web search can pause long turns; resume up to twice.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3, ...(country && { user_location: { type: "approximate" as const, country } }) }],
      messages,
    });
    input += res.usage.input_tokens;
    output += res.usage.output_tokens;
    searches += res.usage.server_tool_use?.web_search_requests ?? 0;
    for (const block of res.content) {
      if (block.type === "text") {
        textParts.push(block.text);
        for (const c of block.citations ?? []) {
          if (c.type === "web_search_result_location") citations.push({ url: c.url, title: c.title ?? null });
        }
      } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) citations.push({ url: r.url, title: r.title ?? null });
      }
    }
    if (res.stop_reason === "refusal") throw new Error("The model declined to answer this prompt.");
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  return { answer: textParts.join(""), citations, costMicros: estimate(model, input, output, searches) };
}

type OpenAIResponse = {
  output?: { type: string; content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

async function askChatGPT(model: string, prompt: string, country?: string): Promise<EngineAnswer> {
  const data = await postJson<OpenAIResponse>(
    "https://api.openai.com/v1/responses",
    { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    { model, input: prompt, tools: [{ type: "web_search", ...(country && { user_location: { type: "approximate", country } }) }] },
  );
  const citations: Citation[] = [];
  const text: string[] = [];
  let searches = 0;
  for (const item of data.output ?? []) {
    if (item.type === "web_search_call") searches++;
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type !== "output_text") continue;
      text.push(c.text ?? "");
      for (const a of c.annotations ?? []) if (a.type === "url_citation" && a.url) citations.push({ url: a.url, title: a.title ?? null });
    }
  }
  return { answer: text.join(""), citations, costMicros: estimate(model, data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0, searches) };
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[]; webSearchQueries?: string[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

async function askGemini(model: string, prompt: string, webSearch: boolean): Promise<EngineAnswer> {
  let data: GeminiResponse;
  try {
    data = await postJson<GeminiResponse>(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
      { contents: [{ role: "user", parts: [{ text: prompt }] }], ...(webSearch && { tools: [{ google_search: {} }] }) },
    );
  } catch (err) {
    if (webSearch && err instanceof Error && err.message.startsWith("429") && /quota/i.test(err.message)) {
      throw new Error(
        "Gemini web search isn't included in this key's quota (free keys usually have none). Enable billing on the Google project, or set GEMINI_WEB_SEARCH=\"off\" in .env to check answers without web search.",
      );
    }
    throw err;
  }
  const cand = data.candidates?.[0];
  // Gemini returns redirect links; the title holds the source domain, so keep both.
  const citations = (cand?.groundingMetadata?.groundingChunks ?? []).flatMap((c) => (c.web?.uri ? [{ url: c.web.uri, title: c.web.title ?? null }] : []));
  const searches = cand?.groundingMetadata?.webSearchQueries?.length ? 1 : 0;
  return {
    answer: (cand?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
    citations,
    costMicros: estimate(model, data.usageMetadata?.promptTokenCount ?? 0, data.usageMetadata?.candidatesTokenCount ?? 0, searches),
  };
}

type PerplexityResponse = {
  choices?: { message?: { content?: string } }[];
  citations?: string[];
  search_results?: { url?: string; title?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

async function askPerplexity(model: string, prompt: string, country?: string): Promise<EngineAnswer> {
  const data = await postJson<PerplexityResponse>(
    "https://api.perplexity.ai/chat/completions",
    { authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` },
    { model, messages: [{ role: "user", content: prompt }], ...(country && { web_search_options: { user_location: { country } } }) },
  );
  const fromResults = (data.search_results ?? []).flatMap((r) => (r.url ? [{ url: r.url, title: r.title ?? null }] : []));
  const citations = fromResults.length ? fromResults : (data.citations ?? []).map((url) => ({ url, title: null }));
  return {
    answer: data.choices?.[0]?.message?.content ?? "",
    citations,
    costMicros: estimate(model, data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0, 1),
  };
}

// market: where the question is asked from. Each engine gets the country through its own location setting;
// Gemini's search grounding has no location parameter, so it runs without one.
export async function askEngine(engine: EngineInfo, prompt: string, market?: string | null): Promise<EngineAnswer> {
  const model = engineModel(engine);
  const country = marketInfo(market)?.country;
  switch (engine.id) {
    case "claude":
      return askClaude(model, prompt, country);
    case "chatgpt":
      return askChatGPT(model, prompt, country);
    case "gemini":
      return askGemini(model, prompt, engineUsesWebSearch(engine));
    case "perplexity":
      return askPerplexity(model, prompt, country);
  }
}
