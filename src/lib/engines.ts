export type EngineId = "chatgpt" | "claude" | "gemini" | "perplexity";

export type EngineInfo = {
  id: EngineId;
  label: string;
  company: string;
  envKey: string;
  modelEnv: string;
  defaultModel: string;
};

export const ENGINES: EngineInfo[] = [
  { id: "chatgpt", label: "ChatGPT", company: "OpenAI", envKey: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL", defaultModel: "gpt-5-mini" },
  { id: "claude", label: "Claude", company: "Anthropic", envKey: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL", defaultModel: "claude-opus-5-5" },
  // The "-latest" alias follows Google's current Flash model; pinned versions get retired for new keys.
  { id: "gemini", label: "Gemini", company: "Google", envKey: "GEMINI_API_KEY", modelEnv: "GEMINI_MODEL", defaultModel: "gemini-flash-latest" },
  { id: "perplexity", label: "Perplexity", company: "Perplexity", envKey: "PERPLEXITY_API_KEY", modelEnv: "PERPLEXITY_MODEL", defaultModel: "sonar" },
];

export function engineInfo(id: string) {
  return ENGINES.find((e) => e.id === id);
}

export function engineModel(e: EngineInfo) {
  return process.env[e.modelEnv] || e.defaultModel;
}

// Web search can be switched off per engine where the account has no search allowance
// (e.g. free Gemini keys). Answers then come from the model's own knowledge, with no citations.
export function engineUsesWebSearch(e: EngineInfo) {
  return e.id !== "gemini" || process.env.GEMINI_WEB_SEARCH !== "off";
}

export function configuredEngines() {
  return ENGINES.filter((e) => Boolean(process.env[e.envKey]));
}
