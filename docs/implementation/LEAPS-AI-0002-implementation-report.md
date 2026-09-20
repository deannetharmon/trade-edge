# LEAPS-AI-0002 — Implementation Report

**Ticket:** [LEAPS-AI-0002](../tickets/LEAPS-AI-0002-market-aware-analysis-freshness.md)
**Base:** `main` @ f37d3a88 (after AI-SEC-0001)

## What changed

| File | Change |
|---|---|
| `lib/leaps-analysis/serverTradeReview.ts` | `resolveWithContext` gains optional `freshness: 'strict' \| 'analysis'` (default `'strict'`); `fresh()` gains optional `maxAgeMs`; `ServerLeapsReview` gains optional `marketSession`, `quoteBasis`; only `resolveLeapsContractEvidence` passes `'analysis'`. Analysis mode: market open → 300 s; market not open → last two-sided quote accepted (timestamps must exist), labelled `last_session`. Strict-mode gate message unchanged |
| `lib/leaps-analysis/analysisService.ts` | Snapshot version `v2`; contract records `quoteBasis` and `marketSession`; provenance records `freshnessPolicy: 'analysis-market-aware-v1'` |
| `app/api/leaps-analysis/route.ts` | One added sentence in the system prompt for `quoteBasis: 'last_session'` |
| `app/screener/page.tsx` | Three added lines: amber "Market closed — quotes are from the prior session…" note in the analysis panel. No new exports |
| `lib/leaps-analysis/__tests__/marketAwareFreshness.test.ts` | **New**, 11 tests |

## Sibling and adjacent paths checked

- `resolveLeapsContractEvidence` has exactly one caller (`app/api/leaps-analysis/route.ts`). Every other user of `resolveWithContext` (`reviewLeapsContract` → dry-run/submit, PMCC review/order gates) still calls it with the default `'strict'`; two tests assert the 60-second rule and the weekend rejection on that path.
- The PMCC functions in the same file use `fresh()` with the default max age — unchanged.
- `evaluateLeapsEntry` (scanner and order gates) untouched; `SERVER_LEAPS_POLICY` values untouched.
- Only `analysisService.test.ts` and the new test reference the snapshot; no test asserted the old version string or provenance shape.
- `derivePmccMarketSession` was already imported by this file; no new calendar code.

## Verification actually run (sandbox clone of `main` + this change)

- `tsc --noEmit` (temporary `tsconfig.check.json`, es2017 target, not committed): **exit 0, no output.**
- New tests: **11 passed.** Against the original `serverTradeReview.ts` / `analysisService.ts`: **9 of 11 fail** (the 2 that pass are behaviors that were already correct: crossed quote rejected; 30-second quote accepted on the strict path).
- All `lib/leaps-analysis` tests: 20 passed.
- Full `vitest run`: **3257 passed, 15 failed (11 files)** — the identical 15 failures in the identical 11 files as on unmodified `main` (recorded in the AI-SEC-0001 report; still awaiting Quinn's triage). Before this change: 3246 passed; the 11 new tests account for the difference.
- **Not run:** `next build` (the Vercel preview/production build is the authoritative check) and any live broker call.

## Manual checks

1. **Now (weekend/closed):** on the LEAPS scan, click Analyze with AI on a candidate that passes the other gates. Expect: amber "Market closed — quotes are from the prior session" line, `Contract status: CONTRACT QUALIFIED`, and an AI analysis whose mechanics open by saying pricing is from the prior session.
2. **Monday, market hours:** the same click returns a normal analysis with no amber line. If it says "no more than 300 seconds old while the market is open", copy `snapshot.contract` (`optionQuoteTimestamp`, `underlyingQuoteTimestamp`, `fetchedAt`) from the Network response for Ian.
3. **Regression:** Review trade / dry-run on a LEAPS candidate behaves as before (still strict; on a weekend it still refuses).

## Follow-ups

- Ian: whether prior-session mode needs an upper age cap (none today, matching the PMCC precedent).
- AI-POLICY-0001D / D7: adopt the same market-aware rule for `leaps_deep_analysis`.
- The server LEAPS policy still ignores the user's scan filters for the analysis (separate decision).
