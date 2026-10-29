# Visibility platform (Phases 0–4)

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

## Phase 4 features

- **Agency workspaces** (`src/lib/access.ts`, `/dashboard/clients`): sign up as an agency, add client workspaces, switch into them. Agency staff can act in their own clients only; client members can't reach the agency or sibling clients.
- **White-label** (`src/lib/branding.ts`, `/dashboard/branding`): agency name, logo, accent colour (with readable text picked automatically) and report footer. Client workspaces inherit them.
- **Reseller billing** (`src/lib/plans.ts`, `src/lib/stripe.ts`): the Agency plan is billed per client workspace (Stripe quantity, kept in sync), and each client gets its own allowance. Set `STRIPE_PRICE_AGENCY_CLIENT`.
- **Public API** (`src/lib/api.ts`, `/api/v1/*`, `/dashboard/api`): read-only sites, audit and visibility endpoints. Keys are stored hashed and shown once, limited to 120 requests per minute per key. Agency keys read a client with `X-Workspace`. Included in the Advanced and Agency plans.
- **Markets** (`src/lib/markets.ts`): each question can target a market; the country goes to each engine's location setting (Claude, ChatGPT, Perplexity; Gemini has none). Per-market rates appear on the visibility page. The audit checks hreflang (validity, return links, self-reference, x-default).
- **Account-success console** (`/staff`): every workspace's plan, usage, API cost this month, failed jobs, unread alerts, attention flags and internal notes. Only emails in `STAFF_EMAILS` can see it; everyone else gets a 404.
- **Hardening**:
  - Outbound connections are validated at connect time (DNS-rebinding safe).
  - Login is rate-limited per account (10 per 15 min) and per network (30 per 15 min); sign-up per network (5 per hour).
  - The worker runs `WORKER_CONCURRENCY` jobs in parallel, and several workers can share the queue safely.
  - `npm run load-test -- <audits> <concurrency> <workers>` runs audits of the local fixture site and checks every one completes exactly once.

## Competitors and email

- **Share of voice** (`src/lib/share-of-voice.ts`, `/dashboard/competitors/<site>`): how often you and each competitor are mentioned across AI answers, who leads each question, and the trend over time.
- **Sentiment** (`src/lib/sentiment.ts`): each answer that mentions you is classed positive, neutral or negative.
- **Email** (`src/lib/notify.ts`, `/dashboard/notifications`): alerts are emailed once each, and weekly or monthly client reports go to members plus extra recipients, branded with the agency's white-label. Set `SMTP_URL` and `MAIL_FROM`; without them mail is logged to the console.

## Security

- Sessions are stored server-side and revoked on logout or password change. Email must be verified, and staff access needs a verified email in `STAFF_EMAILS`.
- Every page and route checks access itself; `tests/route-guards.test.ts` fails if one doesn't.
- Rate limits apply per IP (in `src/proxy.ts`), per workspace, per API key and per login email. Bodies over 4 MB are refused.
- A nonce-based CSP and the usual security headers are sent on every response.
- `npm run build && npm run test:attack` runs a hostile suite: cross-tenant access, forged cookies, spoofed IPs, SSRF, oversized bodies, rate-limit bypass and more.

## Before production

- Switch the Prisma datasource to Postgres. SQLite is the throughput ceiling in the load test, and the queue and rate limits assume one database and one web process.
- Move the in-memory rate limits to a shared store (e.g. Redis) when running more than one web server.
- Set `TRUST_PROXY_HOPS` to the number of proxies in front of the app (0 if none); client IPs are read from the rightmost `X-Forwarded-For` entries.
- Set `APP_URL` (required in production for email links).
- The browser render check (Chromium) resolves DNS itself, so its address check happens per request, not per connection. Run it in an isolated network if that matters.
