# AI-POLICY-0001B — Implementation Report

**Ticket:** [AI-POLICY-0001B](../tickets/AI-POLICY-0001B-scan-summary-and-grounded-chat.md)
**Base:** `main` @ 0f27f85 (includes the ES5 build fix to 0001A)
**Ships dark:** every route returns `unavailable(FLAG_OFF)` until `AI_POLICY_ENABLED` and the route flag are set. No UI (0001C), no change to scanning, `scanSession.ts`, or the Screener page.

## What changed

| File | Change |
|---|---|
| `app/api/ai-policy/snapshots/route.ts` | **New.** `POST` freeze. Session check first, strict body, 2 MB cap |
| `app/api/ai-policy/scan-summary/route.ts`, `grounded-chat/route.ts`, `artifacts/[id]/route.ts` | **New.** Parse, authenticate, call the library, serialize. `runtime='nodejs'`, `dynamic='force-dynamic'`, `maxDuration=60`. No policy logic |
| `lib/ai-policy/builders/attested/scanSession.ts` | **New.** Validates with `validateSessionData`, requires `complete`, re-derives DTE, copies registry fields only |
| `lib/ai-policy/registries/scanSession.ts` | **New.** The citable-field registry and field tables the builder fills from (payload and registry cannot drift) |
| `lib/ai-policy/templates/scanTemplates.ts` | **New.** `scan-summary` and `grounded-chat` prompts (`tmpl-v1-draft`) and the omitted-rows disclosure |
| `lib/ai-policy/freezeScanSession.ts`, `artifactRead.ts`, `http.ts` | **New.** Freeze orchestration (idempotent, dark, rate-limited), owner-only read, reason→HTTP mapping and neutral bodies |
| `lib/ai-policy/routeSpecs.ts`, `gateway.ts` | **Changed.** See "Changes to 0001A code" |
| `lib/ai-policy/builders/testing/scanSessionFixture.ts` | **New.** Real, valid scan sessions built with the screener's own constructors (test-only; lives under `builders/` because only `builders/` may import scan code) |
| `lib/ai-policy/fixtures/fakeRedis.ts`, `testRoute.ts`, two 0001A test files | Test support only: `FakeRedis` now emulates `RESERVE_SCRIPT` in JS so route tests run the whole gateway; the 0001A test specs keep their 0001A semantics; one 0001A test now uses a deep route to prove inertness |
| Tests | 9 new files, 175 new tests (builder, freeze, gateway scan routes, HTTP mapping, deterministic regression, four route files) |

## Defaults I chose where the ticket was silent (Dean: "go" on these)

1. **DTE check:** the scan computes DTE from wall-clock time, rounded. The builder re-derives it from the scan start date with the existing `pmccDte` helper and accepts a difference of at most **1 day**. Every candidate is checked, including ones dropped by the row cap. Long-leg DTE is checked the same way.
2. **HTTP status table** (the ticket cited one in 0001A that does not exist): 503 `FLAG_OFF, KILL_SWITCH, GOVERNANCE, CIRCUIT_OPEN, TIMEOUT, PROVIDER_ERROR`; 429 `BUDGET, RATE_LIMIT`; 422 `INPUT_INVALID, INPUT_MISSING`; 409 `INPUT_STALE`; 404 `NOT_FOUND`; a rejected output is **200** with `status: 'rejected'`. Bodies are always `{status, reason, artifactId}`; 401 is `{status:'unauthorized'}`; oversize is 413.
3. **Citable fields:** symbol, strategy, price, IV rank, earnings date, expiration, DTE, strikes, delta, credit, credit ratio, ROC, POP, capital, breakeven, PMCC long-leg fields and PMCC decision enums, per-symbol outcomes with reason codes and server-side labels, the scan's counts, and the CSP/Targeted rule snapshot. Free-text `failReasons`, `checks` text, OCC symbols, source result ids and published rank are excluded. At most **25** candidate rows; up to **200** outcome rows (more is refused as oversize). All fields use the source `scanCalculation`. **Draft: Ian approves the list, Diane the labels, before any launch.** ROC/POP/credit ratio are shown as raw numbers because the scan does not record their units.
4. **Body cap:** the freeze body is limited to 2 MB (413 above that); a session that large is refused, never truncated.

## Changes to 0001A code (all covered by the existing 367 tests plus new ones)

- **One frozen input serves both routes.** The ticket returns one `analysisInputId` for summary and chat, but the 0001A gateway bound an input to one route. `RouteSpec.inputKind` lets `grounded_chat` read the snapshot frozen for `scan_summary`.
- **`priorArtifactIds`** is loaded by the gateway (acting user only, same input, `ready`/`stale` with output, at most 4, no duplicates, only where the route allows it). Anything missing, foreign, another input's, or rejected is the same `NOT_FOUND`. The template now receives these validated outputs.
- **Chat turns stand alone:** `supersedesPrior: false`, so a new answer does not mark earlier turns stale. A refreshed summary still supersedes the older one.
- **`serverDisclosures`:** server-written notice appended regardless of model output (used when the row cap omitted candidates).
- **`strictFreshness: true` for both scan routes** (was a provisional `false`). Every scan field is `scanCalculation`, and validator rule 4 rejects a citation to a stale source, so a scan older than the D7 8-hour limit is now `unavailable(INPUT_STALE)` before any spend, instead of paying for a call that could only be rejected. The "disclose stale/omitted sources" behavior is still covered in the gateway tests with a non-strict spec.
- **`maxOutputTokens`** raised to 4000 (summary) and 3000 (chat): reasoning-capable models bill hidden reasoning tokens against this limit, and a truncated JSON answer would be rejected. Worst-case cost at `gpt-5.6-luna` rates is under one cent per call. Confirm on the first live call.

## Sibling and adjacent paths checked

- `lib/screener/scanSession.ts` and `scanSessionCache.ts`: read only, not changed; the server never reads IndexedDB. Other consumers of `ScreenerScanSession` (`app/screener/page.tsx`, `features/screener/*`) untouched.
- `app/api/leaps-analysis`, `advisor`, `leaps-advisor`, `analyze`, `ocr`: untouched. `lib/ai/requireSession.ts` reused for the session check; `resolveAutopilotUserId` is not used.
- Import boundary (0001A test, 55 tests) still passes in both directions; the new scan-touching files all live under `builders/`.
- `grep -rn "ai-policy" lib/scans lib/screener lib/portfolio-snapshot lib/order-lifecycle lib/decision-engine lib/autopilot lib/portfolio lib/paper-trading`: no output.

## Verification actually run (sandbox clone of `main` + this change)

- `tsc --noEmit` with the **real `tsconfig.json` (target es5)**: 0 errors, project-wide. With `tsconfig.check.json` (es2017): 0 errors. (0001A's Vercel build failed because I ran only the es2017 config; both are run now.)
- `vitest run lib/ai-policy app/api/ai-policy`: 26 files, 542 tests passed.
- Full `vitest run`: **308 files passed; 4335 tests passed, 2 skipped, 1 todo, 0 failed.**
- **Not run:** `next build`. It fails in the sandbox at `next/font` (no network to Google Fonts), before compiling the app. The Vercel preview build is the authoritative check.
- Real Redis 7.0.15 (sandbox, not a Vercel Preview), full gateway with the fake provider on the real scan flow: 25 concurrent distinct keys, hourly limit 5 → **5 provider calls, 5 accepted, 20 `RATE_LIMIT`**; 25 concurrent requests with one key → **1 provider call, 1 artifact**, and a replay after completion made no further call; keys after: hour=1, month=320, day=320 µUSD; 10 concurrent freezes with one key → **1 stored input**, the rest neutral `RATE_LIMIT` until the first finishes.

## Acceptance criteria

1 builder deep-key test, oversize, DTE mismatch, incomplete/invalid sessions: `builders/scanSession.test.ts`, `snapshots.test.ts` · 2 IDOR (inputs, artifacts, prior ids), identical 404: `freezeScanSession`, `scanSummary`, `groundedChat`, `artifacts` tests · 3 immutability and no mutation of a deep-frozen argument: builder and freeze tests · 4 prompt-injection fixtures, no client assistant text, no tools: `groundedChat.test.ts`, `gatewayScanRoutes.test.ts` · 5 server disclosures: `gatewayScanRoutes.test.ts` · 6 deterministic regression, flags on vs off: `builders/deterministicRegression.test.ts` · 7 neutral bodies and statuses: route tests, `http.test.ts` · 8 idempotency: route and gateway tests, real Redis.

## Manual checks on the preview (needs you)

The ticket's validation step: with the flags on for one test user, freeze → summary → chat → GET, then flags off ⇒ all routes `FLAG_OFF` and the Screener unchanged. There is no UI yet, so this is done with authenticated requests. Preview environment variables needed:

`AI_POLICY_ENABLED=true`, `AI_POLICY_SCAN_SUMMARY_ENABLED=true`, `AI_POLICY_GROUNDED_CHAT_ENABLED=true`, `AI_POLICY_ECONOMY_MODEL=gpt-5.6-luna`, `AI_POLICY_ALLOWED_MODELS=gpt-5.6-luna`, `AI_POLICY_PROVIDER_GOVERNANCE_ATTESTED=true`, `AI_POLICY_PROVIDER_POLICY_VERSION=<string>`, `AI_POLICY_ARTIFACT_KEY` (`openssl rand -hex 32`), `AI_POLICY_SCOPE_SECRET` (16+ characters), `AI_POLICY_USER_MONTHLY_BUDGET_USD`, `AI_POLICY_GLOBAL_DAILY_BUDGET_USD`, `AI_POLICY_SCAN_SUMMARY_HOURLY_LIMIT`, `AI_POLICY_GROUNDED_CHAT_HOURLY_LIMIT`. For the budget-concurrency run only, also `AI_POLICY_PROVIDER_STUB=true` (inert in Production). **Since AI-POLICY-0001F, Preview also needs `AI_POLICY_ALLOW_UNGATED_PREVIEW=true`**, because a route now needs an approved launch gate unless this bypass is set (it is ignored in Production). The attestation must be true only once OpenAI data controls for the account are confirmed, because a real run sends the frozen snapshot (no account numbers) to OpenAI.

## Known limits

- The prompts are drafts. The validator, not the prompt, is the guarantee: a model that ignores the rules is rejected. Expect some rejections until Ian's lexicon and the wording are tuned; that is the intended fail-closed behavior.
- Only the scan's own as-of time is available for a `client_attested` snapshot, so all fields share the 8-hour limit (D7).
- Freeze is limited to 60 snapshots per user per hour (storage abuse, not AI spend). A repeat freeze with the same key returns the first result even if the session body differs.
- The freeze idempotency marker for an in-flight request answers concurrent duplicates with `RATE_LIMIT`; a client that retries gets the stored result.
