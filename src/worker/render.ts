import { assertPublicUrl } from "@/lib/url-safety";

export type RenderResult = { url: string; rawWords: number; renderedWords: number };

const NAV_TIMEOUT_MS = 20_000;

// Loads pages in headless Chromium and counts visible words, to compare with what a bot that
// doesn't run JavaScript sees in the raw HTML. Returns null when no browser is available, so audits
// still complete on machines without Chromium (set RENDER_CHECK=off to skip on purpose).
export async function renderCheck(pages: { url: string; rawWords: number }[]): Promise<RenderResult[] | null> {
  if (process.env.RENDER_CHECK === "off" || pages.length === 0) return null;
  let browser;
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--no-sandbox"],
    });
  } catch {
    return null;
  }
  try {
    const out: RenderResult[] = [];
    for (const p of pages) {
      const context = await browser.newContext({ javaScriptEnabled: true });
      // The browser follows its own requests, so each one gets the same internal-network check as safeFetch.
      await context.route("**/*", async (route) => {
        try {
          await assertPublicUrl(route.request().url());
          await route.continue();
        } catch {
          await route.abort();
        }
      });
      try {
        const page = await context.newPage();
        await page.goto(p.url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
        const text = await page.evaluate(() => document.body?.innerText ?? "");
        out.push({ url: p.url, rawWords: p.rawWords, renderedWords: text.split(/\s+/).filter(Boolean).length });
      } catch {
        // Page failed to render; leave it out rather than guess.
      } finally {
        await context.close();
      }
    }
    return out;
  } finally {
    await browser.close();
  }
}

// A page is "hidden from non-JS bots" when most of its text only exists after scripts run.
export const hasRenderGap = (r: RenderResult) => r.renderedWords - r.rawWords >= 100 && r.renderedWords >= r.rawWords * 3;
