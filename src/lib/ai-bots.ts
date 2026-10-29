// Purpose decides how a block is judged: blocking a "search" bot removes the site from that engine's
// citations; blocking a "training" bot only opts out of model training, which is a legitimate choice.
export type BotPurpose = "search" | "training" | "user-fetch";

export type AiBot = {
  userAgent: string;
  company: string;
  engine: string;
  purpose: BotPurpose;
};

export const AI_BOTS: AiBot[] = [
  { userAgent: "OAI-SearchBot", company: "OpenAI", engine: "ChatGPT Search", purpose: "search" },
  { userAgent: "ChatGPT-User", company: "OpenAI", engine: "ChatGPT (live fetch)", purpose: "user-fetch" },
  { userAgent: "GPTBot", company: "OpenAI", engine: "OpenAI model training", purpose: "training" },
  { userAgent: "Claude-SearchBot", company: "Anthropic", engine: "Claude search", purpose: "search" },
  { userAgent: "Claude-User", company: "Anthropic", engine: "Claude (live fetch)", purpose: "user-fetch" },
  { userAgent: "ClaudeBot", company: "Anthropic", engine: "Anthropic model training", purpose: "training" },
  { userAgent: "PerplexityBot", company: "Perplexity", engine: "Perplexity search", purpose: "search" },
  { userAgent: "Perplexity-User", company: "Perplexity", engine: "Perplexity (live fetch)", purpose: "user-fetch" },
  { userAgent: "Googlebot", company: "Google", engine: "Google Search + AI Overviews", purpose: "search" },
  { userAgent: "Google-Extended", company: "Google", engine: "Gemini training/grounding", purpose: "training" },
  { userAgent: "Bingbot", company: "Microsoft", engine: "Bing + Copilot", purpose: "search" },
  { userAgent: "Applebot", company: "Apple", engine: "Siri / Spotlight", purpose: "search" },
  { userAgent: "Applebot-Extended", company: "Apple", engine: "Apple model training", purpose: "training" },
  { userAgent: "CCBot", company: "Common Crawl", engine: "Open dataset used for training", purpose: "training" },
  { userAgent: "Bytespider", company: "ByteDance", engine: "ByteDance model training", purpose: "training" },
];

export type BotAccessResult = AiBot & {
  allowed: boolean;
  // Set when we tested a live request as this bot: false means a firewall/CDN rejected it.
  reachable?: boolean;
  reachStatus?: number | null;
};
