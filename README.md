# Visibility platform (Phases 0–3)

Web app + background worker that audits a website for search engines and AI assistants.

## Run locally

```bash
npm install
cp .env.example .env   # then set SESSION_SECRET to a long random string
npx prisma migrate dev
```

Run these in two terminals:

```bash
npm run dev          # website on http://localhost:3000
npm run worker:dev   # background worker that runs audits
```

## How it fits together

- **Website** (`src/app`): sign-up/login, dashboard, audit reports. Next.js App Router with server actions.
- **Worker** (`src/worker`): polls the `Job` table, crawls the site (up to 50 pages), checks robots.txt against 15 search/AI crawlers, and writes pages and findings.
- **Database** (`prisma/schema.prisma`): SQLite locally. Every table is scoped to an `Organization`, so one agency account can manage many client domains later.
- **Job queue**: a database table instead of Redis to keep local setup simple. Swap for BullMQ when volume needs it.
- **Cost tracking**: `ApiCallLog` records every billable external call per organization, so tier pricing can be checked against real cost once paid APIs are added.

## Phase 2 features

- **Platform detection** (`src/lib/platforms.ts`): recognises WordPress, Shopify, Wix, Squarespace, Webflow, Ghost, HubSpot and Framer. Findings get platform-specific steps, and issues only the builder controls are marked and excluded from the health score.
- **Scheduled checks and alerts** (`src/worker/scheduler.ts`, `src/worker/alerts.ts`): weekly/monthly audits and AI checks per site. Alerts fire for newly blocked bots, new urgent issues, and AI-visibility drops only when the 95% ranges of two runs don't overlap.
- **Brand profile** (`src/lib/entity.ts`): Organization/Person/Article/Breadcrumb JSON-LD, a visible author box, and a Wikidata QuickStatements draft.
- **Fix engine** (`src/lib/fixes.ts`, `src/lib/fix-engine.ts`): proposes fixes from the latest audit, applies them, re-checks the live page, and rolls back.
  - WordPress: `integrations/wordpress/visibility-connector` (download at `/api/plugin`), connected with an application password stored encrypted. Writes through Yoast SEO when it's installed.
  - Shopify: OAuth app + theme app embed in `integrations/shopify` (deploy with the Shopify CLI using `shopify.app.toml`). Structured data only; other fixes are shown as steps.
  - Other builders: copy-paste code and platform-specific instructions.
- **Plans and billing** (`src/lib/plans.ts`, `src/lib/stripe.ts`): per-plan limits (sites, pages, prompts, repeats, monthly AI answers, auto-fix). Prices live in Stripe; set one price ID per plan. Webhook: `/api/stripe/webhook`.

## Phase 3 features

All of these read data already collected or imported, so they make no AI calls, except the judge, which is opt-in.

- **Accuracy monitor** (`src/lib/truth.ts`, `/dashboard/truth/[id]`): checks stored AI answers against facts you enter. It flags wrong prices, a wrong founding year, discontinued products presented as current, and your claims or statistics credited to a competitor.
- **Question discovery** (`src/lib/discovery.ts`): suggests questions to track from question-style headings on your site, an imported Search Console Queries.csv (non-branded, by impressions), and category templates.
- **Attribution** (`src/lib/attribution.ts`, `/dashboard/attribution/[id]`): imports daily Search Console or Bing exports and compares the weekly AI mention rate with branded clicks, using Spearman's ρ with a permutation test at lags of 0–2 weeks. It needs at least 6 overlapping weeks and states correlation, not cause. It also shows branded clicks before and after the first fix went live.
- **Third-party presence** (`src/lib/presence.ts`, `/dashboard/presence/[id]`): ranks review sites, communities and reference works by how often AI cited them versus the profiles you list, plus publications AI cites in your space. It provides honest how-tos and templates; nothing is posted automatically.
- **Extractability judge, beta** (`src/lib/judge.ts`, `src/worker/judge.ts`): asks Claude Haiku 5.5 whether a short passage on each page answers its question, and discards verdicts whose quote isn't actually on the page. It needs `ANTHROPIC_API_KEY`, an explicit confirmation and quota, and shows the estimated cost before running (well under a cent per page). Override the model with `JUDGE_MODEL`.

## Tests

```bash
npm test
```

Unit tests plus an end-to-end audit against a local fixture site that plants known problems (blocked bots, a firewall that rejects one bot, broken pages, bad schema, a JavaScript-only page) and a visibility run against stubbed AI APIs. It binds port 80 on localhost. Set `CHROMIUM_PATH` to use a specific Chromium for the JavaScript-rendering check; set `RENDER_CHECK=off` to skip the browser and use the HTML heuristic.

`npm run build && npm run test:ui` runs the whole stack (built website, worker process, real browser, fixture site): sign-up and login, adding sites, the audit through the worker, the visibility screens, and checks that one organization can't see another's data. It binds ports 80 and 3100.

The WordPress tests boot a real WordPress (PHP's built-in server + SQLite, no MySQL or Docker) from a cached copy that `scripts/wp-test-env.sh` fetches from npm; they need `php` with `pdo_sqlite`. Yoast is modelled by a stub of its documented filters (`tests/wp/yoast-stub.php`), and Shopify by a mock Admin API with the real theme-embed Liquid rendered through liquidjs.

## Safety

All outbound fetches go through `src/lib/safe-fetch.ts`, which blocks internal/private network addresses on every redirect hop so users can't point the crawler at internal systems.

## Before production

- Switch the Prisma datasource to Postgres.
- Pin outbound connections to the resolved IP to close the DNS-rebinding gap in the address check.
- Add rate limiting on login and sign-up.
