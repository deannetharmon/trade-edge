# SEC-0001 — Tracked `.env.local` Credentials and API Authentication Triage

**Status:** Draft — **urgent**; step S1 needs Dean today, before any other ticket in this package
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
