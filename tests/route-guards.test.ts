import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Next.js renders layouts and pages in parallel, so every protected page must check access itself.
// This fails the build's tests if a page under /dashboard or /staff forgets to.
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test("every protected page and route handler performs its own access check", () => {
  const files = walk("src/app").filter((f) => /\/(page|route)\.tsx?$/.test(f));
  const missing = files.filter((f) => {
    const src = fs.readFileSync(f, "utf8");
    if (f.includes("/dashboard/")) return !/requireUser\(\)/.test(src);
    if (f.includes("/staff/") || f.endsWith("/staff/page.tsx")) return !/requireStaff\(\)/.test(src);
    if (f.includes("/api/v1/")) return !/authenticate\(/.test(src);
    if (f.includes("/api/stripe/")) return !/verifyWebhook\(/.test(src);
    if (f.includes("/api/shopify/webhooks")) return !/verifyWebhookHmac\(/.test(src);
    if (f.includes("/api/shopify/")) return !/requireUser\(\)/.test(src);
    return false; // public: /, /audit, /audit/[id] (free audit), /login, /signup, /verify, /api/plugin
  });
  assert.deepEqual(missing, []);
  const publicOnes = files.filter((f) => !/(dashboard|staff|api\/v1|api\/stripe|api\/shopify)/.test(f)).map((f) => f.replace("src/app", ""));
  assert.deepEqual(publicOnes.sort(), ["/api/plugin/route.ts", "/audit/[id]/page.tsx", "/audit/page.tsx", "/login/page.tsx", "/page.tsx", "/signup/page.tsx", "/verify/page.tsx"], "a new public route appeared; review it and add it here deliberately");
});
