import { test } from "node:test";
import assert from "node:assert/strict";
import { marketInfo, validHreflang } from "@/lib/markets";
import { hreflangFindings } from "@/worker/hreflang";

test("hreflang codes", () => {
  for (const ok of ["en", "de-AT", "en-gb", "zh-Hant", "zh-Hant-TW", "es-419", "x-default"]) assert.ok(validHreflang(ok), ok);
  for (const bad of ["english", "en_GB", "uk-UA-x", "", "de-DEU"]) assert.equal(validHreflang(bad), false, bad);
});

const page = (url: string, statusCode: number, alts: [string, string][]) => ({ url, statusCode, hreflang: alts.map(([lang, href]) => ({ lang, href })) });

test("reciprocal, self-referencing hreflang with x-default produces no findings", () => {
  const set: [string, string][] = [["en", "https://a.com/en/"], ["de", "https://a.com/de/"], ["x-default", "https://a.com/en/"]];
  assert.deepEqual(hreflangFindings([page("https://a.com/en/", 200, set), page("https://a.com/de/", 200, set)]), []);
  assert.deepEqual(hreflangFindings([page("https://a.com/", 200, [])]), [], "sites without hreflang aren't flagged");
});

test("one-way links, invalid codes, missing self, broken targets, no x-default", () => {
  const codes = hreflangFindings([
    page("https://a.com/en", 200, [["en", "https://a.com/en"], ["de", "https://a.com/de"], ["fr", "https://a.com/fr"], ["english", "https://a.com/en"]]),
    page("https://a.com/de", 200, [["de", "https://a.com/de"]]),
    page("https://a.com/fr", 404, []),
    page("https://a.com/es", 200, [["en", "https://a.com/en"]]),
  ]).map((f) => f.code);
  assert.deepEqual(codes.sort(), ["hreflang_broken_target", "hreflang_invalid", "hreflang_no_return", "hreflang_no_self", "hreflang_no_x_default"]);
});

test("market lookup", () => {
  assert.equal(marketInfo("de-DE")?.country, "DE");
  assert.equal(marketInfo("xx-YY"), null);
  assert.equal(marketInfo(null), null);
});

test("each engine receives the market's country in its own location setting; no market sends none", async () => {
  const { askEngine } = await import("@/worker/visibility/providers");
  const { ENGINES } = await import("@/lib/engines");
  const env = { OPENAI_API_KEY: "k", PERPLEXITY_API_KEY: "k", GEMINI_API_KEY: "k", ANTHROPIC_API_KEY: "sk-ant-offline" };
  Object.assign(process.env, env);
  const realFetch = globalThis.fetch;
  const bodies: Record<string, Record<string, unknown>> = {};
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init!.body));
    if (u.includes("anthropic")) {
      bodies.claude = body;
      return Response.json({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    }
    if (u.includes("openai")) bodies.chatgpt = body;
    else if (u.includes("perplexity")) bodies.perplexity = body;
    else bodies.gemini = body;
    return Response.json({});
  }) as typeof fetch;
  try {
    const engine = (id: string) => ENGINES.find((e) => e.id === id)!;
    for (const id of ["claude", "chatgpt", "perplexity", "gemini"]) await askEngine(engine(id), "beste Steuerberater Software?", "de-DE");
    assert.deepEqual((bodies.claude.tools as { user_location: unknown }[])[0].user_location, { type: "approximate", country: "DE" });
    assert.deepEqual((bodies.chatgpt.tools as { user_location: unknown }[])[0].user_location, { type: "approximate", country: "DE" });
    assert.deepEqual((bodies.perplexity.web_search_options as { user_location: unknown }).user_location, { country: "DE" });
    assert.equal(JSON.stringify(bodies.gemini).includes("DE"), false, "Gemini grounding has no location field");
    for (const id of ["claude", "chatgpt", "perplexity"]) await askEngine(engine(id), "q", null);
    assert.equal(JSON.stringify(bodies.claude).includes("user_location"), false);
    assert.equal(JSON.stringify(bodies.chatgpt).includes("user_location"), false);
    assert.equal("web_search_options" in bodies.perplexity, false);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(env)) delete process.env[k];
  }
});
