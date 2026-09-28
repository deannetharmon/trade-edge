# SEC-0001 — Tracked `.env.local` Credentials and API Authentication Triage

**Status:** S1 and S2 done 2026-09-27. **S3 triage table done 2026-09-27** (see below) — found one route more urgent than anything already in this ticket (`screener/[strategy]`, a server-side paid-API credential behind zero auth), one different-in-kind finding (`filters`, no per-user Redis key scoping at all), and two routes that turned out to be dead code from an abandoned Vercel-side TastyTrade experiment (`jobs/start`/`jobs/status`). Awaiting Dean/Paul's go-ahead to implement any of the four; the rest of the scanned routes are confirmed public-by-design or already low-severity.
**Found while:** grounding [AI-POLICY-0001](./AI-POLICY-0001-epic.md) against `main` @ 02b8276c
**Values are deliberately not reproduced in this document.**

## Problem

1. **`.env.local` is tracked in git** (added in commit `9e6cce5a`, 2026-05-12; still tracked). It contains `TASTYTRADE_CLIENT_ID`, `TASTYTRADE_CLIENT_SECRET`, and `TASTYTRADE_REFRESH_TOKEN` entries whose values are not placeholders (lengths 36 / 43 / 557 characters, no placeholder markers). The repository could be cloned **without credentials**, so it is publicly readable. Git history keeps these values even after the file is removed.
2. **Several API routes have no session check.** A scan of `app/api/**/route.ts` for any recognized auth mechanism found none in:
   `ai`, `analyze`, `ocr` (handled in [AI-SEC-0001](./AI-SEC-0001-legacy-ai-route-authentication.md)), and `chart`, `csv`, `debug-balance-history`, `filters`, `historical-growth`, `jobs/start`, `jobs/status/[jobId]`, `market`, `positions`, `screen`, `screener/[strategy]`, `auth/login`, `auth/status`, `autopilot/health`.
   Severity varies. Examples: `market` / `chart` proxy public market data; `positions` and `debug-balance-history` use `getSessionToken()`, which reads the *caller's own* `tt_access_token` / `tt_refresh_token` cookies (so they are not open to a caller without a broker cookie); `jobs/start` lets any caller start a server-side ranked-scan job (`maxDuration = 60`). The scan is a heuristic; a route may enforce access in a way it did not recognize.
3. `resolveAutopilotUserId` honors a `x-debug-auth-bypass` header when `DEBUG_AUTH_BYPASS_USER_ID` is set. It must never be set in production.

## User value

Removes the risk that a third party holds working credentials for Dean's brokerage API access, and closes avoidable cost/abuse paths.

## Scope

**S1 — Dean, immediately (no code):**
- Treat the tracked TastyTrade values as compromised. **Rotate** the OAuth client secret and revoke/reissue the refresh token in TastyTrade; update the corresponding Vercel environment variables (Production and Preview); confirm the app still connects.
- Review TastyTrade account activity for API sessions or orders you do not recognize.
- Confirm the GitHub repository's visibility; make it private if public exposure is not intended.
- Confirm `DEBUG_AUTH_BYPASS_USER_ID` is **not** set in Vercel Production.

**S2 — Dane:** `git rm --cached .env.local`; add `.env.local` and `.env*.local` to `.gitignore`; confirm `.env.example` contains placeholders only. This stops future exposure but does **not** remove history — rotation (S1) is the real fix.

**S3 — Dane:** produce a triage table of the routes in Problem 2 (route, callers found in the repo, credential/cost/data sensitivity, proposed treatment: *public by design* / *require session* / *retire*). Implement only the treatments Paul approves. For any route set to *require session*, list every page calling it and confirm those pages are behind the middleware matcher or handle a 401.

**S4 — Dean decides (optional):** history rewrite (e.g., `git filter-repo`) after rotation. Cost: rewrites `main`, invalidates clones and open branches. Benefit: hygiene only, once secrets are rotated.

## Non-goals

- No change to TastyTrade auth flows or token handling in this ticket.
- No AI-route changes (see AI-SEC-0001).

## Acceptance criteria

1. Dean attests S1 complete (rotated secret + refresh token; env updated; app connects; repo visibility confirmed; bypass variable confirmed unset).
2. `.env.local` is untracked and ignored; a fresh clone contains no credential-bearing env file.
3. Triage table delivered and reviewed by Paul; approved treatments implemented with 401 tests (pattern: `app/api/paper-trading/__tests__/security.test.ts`).
4. No regression on pages that call any changed route.

## Implementation notes

- Verify exact file contents in the repo before patching (standing rule). Do not print or commit any credential value in scripts, logs, or reports.
- For each newly protected route use `getServerSession(authOptions)` directly. Do **not** use `resolveAutopilotUserId` (debug bypass).
- Sibling paths to state in the report: all `app/api/**/route.ts`, `middleware.ts` matcher, and every `fetch('/api/...')` caller of a changed route.

## Validation steps

`tsc --noEmit` (tsconfig.check.json), full `npm test`, Vercel preview build, then manual: unauthenticated request to each changed route returns 401; logged-in flows unchanged.

## Rollout notes

S1 first and independent of code. S2 can ship immediately after. S3 per route, lowest-risk first, each behind the Vercel preview check.


## S1/S2 completion note (2026-09-27)

S1: Dean rotated the TastyTrade client secret and refresh token, and the Google OAuth client secret, during a live incident that also surfaced and fixed three unrelated bugs (see `docs/TICKET-STATUS.md`, AUTH-LOOP-0001). S2: `.env.local` removed from git tracking (`git rm --cached`), `.env`/`.env.local`/`.env*.local` added to `.gitignore`. The tracked historical values in git history are now dead credentials — S3 (the route-by-route auth triage) remains open but is no longer urgent.

## S3 triage table (2026-09-27)

`ai` and `ocr` no longer need triage here: `ai` has been removed from the codebase entirely since this ticket was written, and `ocr` was already handled by AI-SEC-0001 (session-gated, like `analyze` below).

| Route | Callers found | Sensitivity | Proposed treatment |
|---|---|---|---|
| `analyze` | Screener/portfolio AI panels | Server-only `OPENAI_API_KEY`, real spend per call | **Already fixed** — AI-SEC-0001 added a session check ahead of the key read |
| `chart`, `market`, `historical-growth` | Screener/portfolio charts | Free, public Yahoo Finance proxy; no credentials, no cost, no persistence (`market` already whitelists allowed symbols) | **Public by design** — no change |
| `csv` | Screener export | Pure client-echo formatter — reformats the POST body as CSV; never fetches or reads anything server-side | **Public by design** — no change |
| `positions`, `debug-balance-history`, `screen` | Portfolio/screener pages | Each requires the caller's own TastyTrade token/cookie (`getSessionToken()` or an explicit `accessToken` in the body) — a credential-less caller cannot invoke real TastyTrade calls through them | **Low severity by design** — no change needed, matches this ticket's own original assessment |
| `auth/status` | App shell (login-state check) | Returns only a boolean; must be callable without a session by definition | **Public by design** — no change |
| `autopilot/health` | Health/monitoring check | Redis ping only, no sensitive data, negligible cost | **Public by design** — no change |
| **`jobs/start`, `jobs/status/[jobId]`** | **None found — dead code.** Grepped the whole client codebase for `/api/jobs/start` and `/api/jobs/status`: zero callers. `features/screener/hooks/useRankedScan.ts`'s own header comment explains why: this was "the experimental server-side TastyTrade scan path," abandoned after it "hit authorization failures from Vercel" (TastyTrade blocks Vercel server IPs, per `CLAUDE.md`'s own TastyTrade constraints) and "restored to the browser/TaskManager execution path." `lib/jobs/runners/ranked-scan-job.ts` confirms it still calls the same TastyTrade-hitting `runRankedScan` — so even if someone did call this route today, it cannot work from Vercel. Originally triaged as "require session" (a live cost/abuse vector); corrected once the caller search came up empty. | **Retire** — delete the dead route files and `lib/jobs/*`/`lib/jobs/runners/ranked-scan-job.ts` rather than patch auth onto code that cannot function. (`jobId`'s `Math.random()`-based id in `lib/jobs/store.ts:11` is moot once this is gone — noted here only because it was found during the same check.) |
| **`screener/[strategy]`** | Screener page (PMCC/credit-spread/covered-call/CSP search) | **New finding, more severe than anything else in this table.** No session check at all, and it calls `fetchOptionChainFromProvider` (`lib/screener/provider.ts:24-27`), which sends a **server-side stored secret** (`process.env.MARKET_DATA_API_TOKEN`) to a paid/rate-limited market-data API, for an unbounded `symbols` array from the request body. Any anonymous caller who finds this endpoint can spend Dean's market-data API quota/cost with no limit visible in the route itself. Same category of risk AI-SEC-0001 already fixed for `analyze`/`ai`/`ocr` (a server-only credential behind an unauthenticated route) | **Require session — recommend treating with the same urgency as AI-SEC-0001, not "no longer urgent"** |
| **`filters`** | Screener saved-filter presets | **New finding, different in kind from "no session check."** Reads/writes a **global, non-user-scoped Redis key** (`filters:${strategy}`, e.g. `filters:global`) — not just missing a session check, but missing per-user namespacing entirely, unlike every other Redis-backed feature in this app (keyed by Google OAuth user ID per `CLAUDE.md`). Any caller who finds the endpoint can read, overwrite, or delete Dean's saved filter presets | **Require session AND change the Redis key to include the user id** (e.g. `filters:${userId}:${strategy}`) — a slightly bigger change than a plain session-gate, since existing saved presets under the old bare key would need a one-time migration or would simply start fresh under the new key |

For the two routes moved to *require session*: `screener/[strategy]` and `filters` are both called from `app/screener/page.tsx` (confirmed by grep), which already requires a NextAuth session to render (the page is behind the app's normal sign-in flow) — so gating the routes themselves closes the gap without needing new client-side handling beyond a 401 fallback, which neither of these calls currently has (worth adding a plain "sign in again" message on 401, not silently failing).

**Awaiting Paul/Dean's go-ahead to implement:** `screener/[strategy]` requiring a session is a direct, low-risk repeat of the AI-SEC-0001 pattern, with real urgency given the server-side paid-API credential sitting behind it. `filters`' Redis key change is slightly larger (needs a decision on whether to migrate existing saved presets or let them start fresh) and should be scoped separately if Dean wants old presets preserved. `jobs/start`/`jobs/status` need a decision to actually delete dead files, not just a routine fix — flagging for Dean/Paul rather than deleting unilaterally.
