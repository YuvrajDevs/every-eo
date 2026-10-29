import robotsParser from "robots-parser";
import { AI_BOTS, type BotAccessResult } from "@/lib/ai-bots";
import { safeFetch } from "@/lib/safe-fetch";

export type FindingInput = {
  layer: "seo" | "aeo" | "geo";
  code: string;
  severity: "high" | "medium" | "low" | "info";
  evidence: "proven" | "plausible" | "speculative";
  title: string;
  detail: string;
  url?: string;
};

export type RobotsAnalysis = {
  robotsUrl: string;
  httpStatus: number | null;
  found: boolean;
  sitemaps: string[];
  botAccess: BotAccessResult[];
  findings: FindingInput[];
};

export async function analyzeRobots(origin: string): Promise<RobotsAnalysis> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  let httpStatus: number | null = null;
  let text = "";
  try {
    const res = await safeFetch(robotsUrl);
    httpStatus = res.status;
    if (res.status === 200 && !res.contentType.includes("text/html")) text = res.body;
  } catch {
    httpStatus = null;
  }

  const found = text.length > 0;
  const robots = robotsParser(robotsUrl, text);
  const homepage = new URL("/", origin).toString();
  const botAccess: BotAccessResult[] = AI_BOTS.map((bot) => ({
    ...bot,
    allowed: robots.isAllowed(homepage, bot.userAgent) !== false,
  }));
  const sitemaps = robots.getSitemaps();
  const findings: FindingInput[] = [];

  if (!found) {
    findings.push({
      layer: "seo",
      code: "robots_missing",
      severity: "low",
      evidence: "proven",
      title: "No robots.txt file found",
      detail:
        "Every crawler is allowed by default, which is fine for visibility, but you have no way to opt out of AI training or point crawlers to your sitemap.",
      url: robotsUrl,
    });
  }

  for (const bot of botAccess) {
    if (bot.allowed) continue;
    if (bot.purpose === "search" || bot.purpose === "user-fetch") {
      findings.push({
        layer: bot.userAgent === "Googlebot" || bot.userAgent === "Bingbot" ? "seo" : "geo",
        code: `bot_blocked_${bot.userAgent.toLowerCase()}`,
        severity: bot.purpose === "search" ? "high" : "medium",
        evidence: "proven",
        title: `${bot.userAgent} is blocked — you can't be cited in ${bot.engine}`,
        detail: `robots.txt disallows ${bot.userAgent} (${bot.company}) from your homepage. This bot fetches pages for ${bot.engine}; while it's blocked, those answers cannot cite or link to you.`,
        url: robotsUrl,
      });
    } else {
      findings.push({
        layer: "geo",
        code: `bot_training_optout_${bot.userAgent.toLowerCase()}`,
        severity: "info",
        evidence: "proven",
        title: `${bot.userAgent} (training) is blocked`,
        detail: `This only opts you out of ${bot.engine}. It does not stop the same company's search bot from citing you, so this is a valid choice rather than a problem.`,
        url: robotsUrl,
      });
    }
  }

  if (found && sitemaps.length === 0) {
    findings.push({
      layer: "seo",
      code: "robots_no_sitemap",
      severity: "low",
      evidence: "proven",
      title: "robots.txt doesn't list a sitemap",
      detail: "Adding a `Sitemap:` line helps every crawler, including AI search bots, discover all of your pages.",
      url: robotsUrl,
    });
  }

  return { robotsUrl, httpStatus, found, sitemaps, botAccess, findings };
}
