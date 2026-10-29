# Visibility platform (Phase 0)

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

## Tests

```bash
npm test
```

Unit tests plus an end-to-end audit against a local fixture site that plants known problems (blocked bots, a firewall that rejects one bot, broken pages, bad schema, a JavaScript-only page) and a visibility run against stubbed AI APIs. It binds port 80 on localhost. Set `CHROMIUM_PATH` to use a specific Chromium for the JavaScript-rendering check; set `RENDER_CHECK=off` to skip the browser and use the HTML heuristic.

## Safety

All outbound fetches go through `src/lib/safe-fetch.ts`, which blocks internal/private network addresses on every redirect hop so users can't point the crawler at internal systems.

## Before production

- Switch the Prisma datasource to Postgres.
- Pin outbound connections to the resolved IP to close the DNS-rebinding gap in the address check.
- Add rate limiting on login and sign-up.
