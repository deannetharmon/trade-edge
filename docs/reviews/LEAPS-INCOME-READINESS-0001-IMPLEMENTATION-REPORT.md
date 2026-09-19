# LEAPS-INCOME-READINESS-0001 — Implementation Report

## Status

Ready for team approval. This report describes uncommitted work on
`codex/leaps-income-readiness`, based on current GitHub `main` at
`ea7a0dda`.

## What changed

### 1. Held-LEAPS PMCC readiness is now explicit

The existing Portfolio income panel now presents a broker-held single-leg
long call using three trader-facing PMCC states:

| State | Meaning | Behavior |
|---|---|---|
| **Not ready** | Broker evidence, account identity, contract structure, or long-call DTE is not valid for PMCC review. | No action is enabled; the specific blocking reason and next step are shown. |
| **Monitor** | The LEAPS foundation is valid, but its short-call capacity is reserved by an open or working short call. | A required standardized reason, `capacity-reserved`, is shown with the next step. |
| **Review income call** | Exact broker-held LEAPS identity and available capacity are verified. | **Review PMCC short calls** opens the existing exact-held-LEAPS PMCC review flow. |

This is a review-routing state, not a recommendation to sell a call. The
description explicitly says that the PMCC review rechecks current
short-call candidates and quotes.

### 2. The PMCC action stays broker-bound and fail-closed

The implementation retains the current exact-foundation handoff:

- account number
- Portfolio position key
- underlying symbol
- exact long-call OCC symbol

The handoff does not use a ticker-only shortcut and does not submit an
order. The existing PMCC screen refreshes broker holdings and revalidates
the exact held long call before presenting the short-call review path.

### 3. Monitor is no longer ambiguous

The model now supports a typed primary Monitor reason. This implementation
uses `capacity-reserved` for an open paired short call or a matching working
short-call order. The UI explains the reason in plain language.

The type also reserves these future standardized reasons without inventing
new qualification policy:

- `no-qualifying-short-call`
- `quote-quality`
- `preference-not-met`

### 4. LEAPS result sorting now follows intended direction

- Score and open interest select descending order by default.
- Spread %, extrinsic dollars, and extrinsic percent of cost select
  ascending order by default.
- Missing values sort after comparable values in every sort direction.

This fixes the prior behavior where choosing Score or OI after another sort
started low-to-high.

## Explicitly unchanged

- Conventional stock covered-call qualification, behavior, labels, and
  action paths.
- PMCC thresholds and pairing policy.
- LEAPS entry-score formula and its weights.
- LEAPS entry flow, Long Book, automatic trade suggestions, and any order
  submission behavior.
- Existing broker order lifecycle and final order validation.

## Important scope note for team approval

Portfolio now invokes the same browser-side PMCC chain acquisition and
production evaluator used by the Screener for each exact held LEAPS when the
income panel is expanded. It renders the fresh evaluation as **Review income
call**, **Monitor** (`quote-quality` or `no-qualifying-short-call`),
**Market closed**, or **Not ready**. A qualified state also shows the short
candidate's delta, DTE, OI, executable credit, and spread percentage.

The chain-acquisition code was extracted from the Screener into one shared
module before Portfolio consumed it. There is no second PMCC scan or
parallel qualification policy. Final broker order validation remains the
existing downstream safeguard.

## Files changed

- `app/screener/page.tsx`
- `features/portfolio/positions-workspace/PositionsWorkspace.tsx`
- `features/portfolio/positions-workspace/model/buildPositionsWorkspaceModel.ts`
- `features/portfolio/positions-workspace/model/types.ts`
- `lib/scans/pmccChainClient.ts` (shared chain acquisition)
- `lib/scans/pmccHeldReadinessClient.ts` (shared live held-LEAPS evaluator)
- focused tests for the workspace model and UI

## Validation

- `vitest`: 90 focused tests passed across the Portfolio model and UI, the
  PMCC production evaluator, and the Screener.
- Type check: passed with no errors.
- Diff whitespace check: passed.

## Approval questions

- **Ian:** Is the distinction between verified foundation readiness and
  short-call candidate qualification accurate and sufficiently clear?
- **Alan:** Are all presented states explainable from the current broker
  evidence, without implying unavailable quote data is a failed trade rule?
- **Quinn:** Does retaining the exact account/position/OCC handoff and the
  downstream revalidation meet the intended safety boundary?
- **Diane:** Is “Review income call” and its explanation clear without
  overloading the existing Portfolio panel?
- **Paul:** Confirm the shared evaluator and review-only handoff meet the
  ticket's intended boundary.
