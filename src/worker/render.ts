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
      // Untrusted sites' JavaScript runs here. Keep Chromium's sandbox on unless running as root (where it can't
      // start), and turn off the JIT, the most common source of renderer exploits.
      args: [...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), "--js-flags=--jitless", "--disable-dev-shm-usage", "--disable-gpu"],
    });
  } catch {
    return null;
  }
  try {
    const out: RenderResult[] = [];
    for (const p of pages) {
      const context = await browser.newContext({ javaScriptEnabled: true, acceptDownloads: false, serviceWorkers: "block" });
      // The browser follows its own requests, so each one gets the same internal-network check as safeFetch.
      await context.route("**/*", async (route) => {
        try {
          const u = route.request().url();
          if (!/^https?:/i.test(u) && !u.startsWith("data:") && !u.startsWith("blob:")) throw new Error("blocked scheme");
          if (/^https?:/i.test(u)) await assertPublicUrl(u);
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
