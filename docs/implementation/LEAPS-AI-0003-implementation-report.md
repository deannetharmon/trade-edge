# LEAPS-AI-0003 — Implementation Report

**Ticket:** [LEAPS-AI-0003](../tickets/LEAPS-AI-0003-analysis-uses-scan-filters.md)
**Base:** `main` @ dc6698e7 (after LEAPS-AI-0002)
**Decision:** D-A = (a) — analysis runs for `REVIEW_REQUIRED` (no extrinsic ceiling) and is labelled; `NOT_QUALIFIED` / `DATA_UNAVAILABLE` never reach the model.

## What changed

| File | Change |
|---|---|
| `lib/leaps-analysis/criteria.ts` | **New.** `resolveLeapsCriteria(body)` — the former trade-review `resolveCriteria`, moved unchanged; `resolveAnalysisCriteria(body)` — server policy when the request carries none of the six filter fields, otherwise the same rule as the order gate |
| `app/api/leaps-analysis/trade-review/route.ts` | Uses `resolveLeapsCriteria`; local copy of the function removed. Behavior unchanged |
| `app/api/leaps-analysis/route.ts` | Resolves criteria from the request, passes them to the evidence resolver, records them in the snapshot, proceeds when `isAnalysisEligible(status)`; prompt gains the "computed by TradeEdge from the trader's own filters / REVIEW_REQUIRED means mechanics only" instruction |
| `lib/leaps-analysis/serverTradeReview.ts` | `resolveLeapsContractEvidence(userId, input, criteria = SERVER_LEAPS_POLICY)`; prior-session quotes capped at 5 calendar days with distinct gate messages |
| `lib/leaps-analysis/analysisService.ts` | Snapshot version `v3`; `criteria` on the snapshot (`SnapshotCriteria`, `snapshotCriteria()`); `isAnalysisEligible()`; `buildSnapshot` takes an optional criteria argument (older callers get `null`) |
| `app/screener/page.tsx` | `runAnalysis` sends the six filter values the row already holds; panel shows "Judged against your scan filters: …" and, for `REVIEW_REQUIRED`, the amber "Extrinsic ceiling not set…" line. No new exports |
| Tests | 4 new files, 25 tests (see ticket) |

## Sibling and adjacent paths checked

- The former `resolveCriteria` had one caller (trade-review route). The moved function is compared against a verbatim copy of the old one on a 40-input battery (including `null`, strings, out-of-range, `0`/`null` extrinsic); the order route test asserts it passes exactly `resolveLeapsCriteria(body)` and that an omitted ceiling still means "Any" (no server-default shortcut on the order path).
- `resolveLeapsContractEvidence` still has one caller (the analysis route). `reviewLeapsContract`, `submitLeapsOrder`, PMCC gates: untouched, still `'strict'` 60 s.
- `evaluateLeapsEntry`, `SERVER_LEAPS_POLICY` values, scan qualification: untouched.
- `buildSnapshot` is called from the analysis route and `analysisService.test.ts` (4-argument form still valid).
- Older saved snapshots (v1/v2) have no `criteria`; the panel renders the rule line only when it exists.

## Verification actually run (sandbox clone of `main` + this change)

- `tsc --noEmit` (temporary `tsconfig.check.json`, es2017 target, not committed): **exit 0, no output.**
- New tests: **25 passed**; all `lib/leaps-analysis` and `app/api/leaps-analysis` tests: **45 passed.** Against the pre-change source **15 of the new tests fail** (the rest cover behavior that was already correct).
- Full `vitest run`: **3282 passed, 15 failed (11 files)** — the identical 15 failures in the identical 11 files as on unmodified `main` (recorded in the AI-SEC-0001 report; still awaiting Quinn's triage). Before this change: 3257 passed; the 25 new tests account for the difference.
- **Not run:** `next build` (Vercel is the authoritative check); no live broker or OpenAI calls.

## Manual checks

1. LEAPS scan → set the delta/DTE/OI/extrinsic filters → Analyze with AI: the panel's "Judged against your scan filters" line matches the filters, and the verdict matches the row.
2. Set the extrinsic ceiling to **Any** → the row says REVIEW REQUIRED, the panel runs and shows "Extrinsic ceiling not set — explaining mechanics only…".
3. Choose filters the contract fails (e.g., delta floor 0.90) → panel says NOT QUALIFIED with no analysis.
4. Review trade / dry-run still behave as before (strict quotes, same criteria).

## Follow-ups

- AI-POLICY-0001D must take criteria from the frozen scan input, not the request (Alan).
- Ian: whether prior-session mode needs anything beyond the 5-day cap.

## Follow-up (2026-09-20): model must not state qualification

First live use showed an analysis of a `CONTRACT_QUALIFIED` contract saying "not fully qualified": the prompt sentence written for discovery mode (`REVIEW_REQUIRED`) was applied to a qualified contract. Fixed: the prompt no longer asks the model to comment on qualification (TradeEdge's amber line already labels discovery mode), and `validateAnalysisOutput` rejects any model text that states or implies qualification (`qualified`, `unqualified`, `qualify/qualifies/qualifying`); one automatic retry, then the analysis shows as unavailable. The status field name `qualification.status` and the value `CONTRACT_QUALIFIED` remain allowed as evidence. Tests: `qualificationClaims.test.ts` and two route-level cases (retry succeeds; persistent claim is not displayed). Full suite: 260 files / 3308 passed / 2 skipped / 1 todo / 0 failed; `tsc` exit 0.

## Follow-up (2026-09-20): display-precision numbers

The analysis evidence showed raw broker floats (`extrinsicPerShare: 12.692000000000007`, `spreadPct: 2.3778071334214026`). `buildSnapshot` now rounds the mechanics and the qualification percentages to 2 decimals and delta / implied volatility to 4; broker prices, strike and open interest are untouched, and qualification status and gates are unchanged. Tests: `snapshotRounding.test.ts`.
