# AI-SEC-0001 — Implementation Report

**Ticket:** [AI-SEC-0001](../tickets/AI-SEC-0001-legacy-ai-route-authentication.md)
**Base:** `main` @ 42cf577c
**Decisions:** D11 = require login (Dean, 2026-09-19). `OPENAI_API_KEY` confirmed set in Vercel by Dean.

## What changed

| File | Change |
|---|---|
| `lib/ai/requireSession.ts` | **New.** `requireSessionUserId()` via `getServerSession(authOptions)`; no debug-bypass header |
| `app/api/analyze/route.ts` | Session check first (401 before key read, body parse, or upstream call); key read only from `OPENAI_API_KEY` (fallback to `NEXT_PUBLIC_OPENAI_API_KEY` removed). Nothing else changed |
| `app/api/ocr/route.ts` | Session check first; `OPENAI_API_KEY` only (missing → 500, no upstream call — previously sent an empty `Bearer`); `mediaType` allowlist (`image/png`, `image/jpeg`, `image/webp`, `image/gif`) → 400 otherwise. Prompt text unchanged |
| `app/api/ai/route.ts` | **Deleted.** Unauthenticated raw OpenAI passthrough; no callers found in `app/`, `lib/`, `components/`, `features/`, `hooks/` |
| `middleware.ts` | Added `'/wheel-simulator/:path*'` to the matcher |
| `.env.example` | Documents server-only `OPENAI_API_KEY` |
| `app/api/analyze/__tests__/auth.test.ts`, `app/api/ocr/__tests__/auth.test.ts` | **New**, 9 tests |

No `NEXT_PUBLIC_OPENAI` reference remains in `app/`, `lib/`, `components/`, `features/`, `hooks/`, `middleware.ts`, or `.env.example`, except inside the two `__tests__/auth.test.ts` files, which set that variable on purpose to prove the fallback is gone.

## Behavior changes to be aware of

- Signed-out callers of `/api/analyze` and `/api/ocr` now get `401`. The pages that call them are behind the middleware matcher (including, now, `wheel-simulator`), so normal use is unchanged.
- If a NextAuth session expires while a page is open, AI actions on that page return 401 (surfaced as that page's normal AI error) until the user signs in again. Previously they kept working.
- `/api/ocr` rejects HEIC and other non-listed image types with 400 "Unsupported image type" (OpenAI vision does not accept HEIC either).

## Sibling and adjacent paths checked

- All `app/api/**/route.ts` scanned for any session/auth mechanism. 14 other routes (`chart`, `csv`, `debug-balance-history`, `filters`, `historical-growth`, `jobs/start`, `jobs/status/[jobId]`, `market`, `positions`, `screen`, `screener/[strategy]`, `auth/login`, `auth/status`, `autopilot/health`) show no recognized check; **not changed here** — tracked in [SEC-0001](../tickets/SEC-0001-tracked-env-file-and-api-auth-triage.md) for Paul's triage.
- `/api/advisor` and `/api/leaps-advisor` already call `getServerSession` and read only `OPENAI_API_KEY`; `/api/leaps-analysis` is authenticated. Untouched.
- Callers: every `fetch('/api/analyze')` (18 sites in `portfolio`, `screener`, `engine`, `trade-log`, `rinse-repeat`, `performance`, `wheel-simulator`) and the single `/api/ocr` call (`app/screener/page.tsx`) use same-origin fetch (session cookie sent by default); none sets `credentials: 'omit'`. No caller of `/api/ai` exists. No server-side/internal caller of `/api/analyze` exists.
- `resolveAutopilotUserId` was **not** used (it honors a debug bypass header).

## Verification actually run (sandbox clone of `main` + this change)

- `tsc --noEmit` with a temporary `tsconfig.check.json` (`extends ./tsconfig.json`, target `es2017`): **exit 0, no output.** (The repo does not contain `tsconfig.check.json`; a temporary copy was used and not committed.)
- New tests: **9 passed.** Run against the *original* routes (change stashed): **7 of 9 fail**, i.e. they detect the vulnerability; the 2 that pass on the original are the intentional "behavior unchanged" checks (authenticated proxy on `/api/analyze`, missing-fields 400 on `/api/ocr`).
- Full `vitest run`: **3246 passed, 15 failed (11 files).** The identical 15 failures occur on unmodified `main` (verified by stashing this change and re-running those 11 files: 15 failed / 98 passed). They are unrelated to this change:
  `app/api/entry-context/snapshots/__tests__/route.test.ts`, `app/screener/__tests__/{CcCapacityGate,CspCandidateDiscovery,OiAndSortWiring,PmccResultCardFields,ScreenerSessionWiring,ScreenerUXHierarchy,UnifiedStrategyLauncher}.test.tsx`, `features/screener/components/__tests__/CspScanModal.test.tsx`, `lib/portfolio-mode/__tests__/portfolioExecutionIntegration.test.ts`, `lib/scans/__tests__/pmccDecision.test.ts`.
  They may be sandbox-environment specific or a real regression on `main`; **needs Quinn's triage** (out of scope for this ticket).
- **Not run:** `next build`. The Vercel preview build is the authoritative check (no named exports were added to any `page.tsx`).

## Manual checks for the preview / production

1. Signed out: `curl -i -X POST https://<deployment>/api/analyze -H 'content-type: application/json' -d '{}'` → `401`. Same for `/api/ocr`.
2. Signed in: an AI action on Portfolio (e.g., a stop-dialog analysis) and a screenshot upload on Screener both still work.
3. Signed out, open `/wheel-simulator` → redirected to login.

## Follow-ups

- After merge, remove `NEXT_PUBLIC_OPENAI_API_KEY` from Vercel. Rotating the OpenAI key is Dean's call (check the usage dashboard for unexplained spend first).
- `/api/analyze` still lets the client choose `model`/`profile` — migrate under AI-POLICY-0002.
- SEC-0001 step S1 (rotate the TastyTrade values in the tracked `.env.local`) remains outstanding and independent of this change.
- Quinn to triage the 15 pre-existing failing tests.
