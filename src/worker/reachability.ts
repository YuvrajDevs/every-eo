import type { BotAccessResult } from "@/lib/ai-bots";
import { safeFetch } from "@/lib/safe-fetch";
import type { FindingInput } from "@/worker/robots";

// Published user-agent strings for AI crawlers that fetch pages for answers.
const BOT_UA: Record<string, string> = {
  "OAI-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  "ChatGPT-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  "Claude-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)",
  "Claude-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  PerplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  "Perplexity-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
};

const CHALLENGE = /cf-chl|just a moment\.\.\.|attention required|captcha|access denied/i;

export type ReachabilityResult = { userAgent: string; status: number | null; blocked: boolean };

// robots.txt can allow a bot while a firewall/CDN still rejects it. We request the homepage
// identifying as each AI bot and compare with a normal request.
export async function checkReachability(homepage: string, bots: BotAccessResult[]) {
  let baseline: number | null = null;
  try {
    baseline = (await safeFetch(homepage)).status;
  } catch {
    return { results: [] as ReachabilityResult[], findings: [] as FindingInput[] };
  }
  if (baseline >= 400) return { results: [], findings: [] };

  const targets = bots.filter((b) => b.allowed && BOT_UA[b.userAgent]);
  const results = await Promise.all(
    targets.map(async (b): Promise<ReachabilityResult> => {
      try {
        const res = await safeFetch(homepage, BOT_UA[b.userAgent]);
        const blocked = res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503 || (res.status === 200 && CHALLENGE.test(res.body.slice(0, 5000)));
        return { userAgent: b.userAgent, status: res.status, blocked };
      } catch {
        return { userAgent: b.userAgent, status: null, blocked: true };
      }
    }),
  );

  const findings: FindingInput[] = results
    .filter((r) => r.blocked)
    .map((r) => {
      const bot = bots.find((b) => b.userAgent === r.userAgent)!;
      return {
        layer: "geo",
        code: `firewall_blocks_${r.userAgent.toLowerCase()}`,
        severity: bot.purpose === "search" ? "high" : "medium",
        evidence: "plausible",
        title: `Your server rejected ${r.userAgent} even though robots.txt allows it`,
        detail: `A request identifying as ${r.userAgent} (${bot.engine}) got ${r.status ? `HTTP ${r.status}` : "no response"}, while a normal request worked. A firewall or CDN bot rule is likely blocking it. If your firewall only lets through verified bot IP addresses, the real ${bot.company} crawler may still get in — check your CDN's bot settings to be sure.`,
        url: homepage,
      } satisfies FindingInput;
    });

  return { results, findings };
}
