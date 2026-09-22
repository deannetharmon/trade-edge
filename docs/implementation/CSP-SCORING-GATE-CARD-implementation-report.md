# CSP scoring, Best-Opportunities gate, and card parity — Implementation Report

**Trigger:** Dean's screenshots showed an AAPL 400-strike CSP (POP 0%, OI 0, delta ~1.00) ranked #1 in "Best Opportunities" with a score of 78, and CSP result cards showing none of the labeled POP/Delta/OTM/OI stats that spreads and CC already show.
**Base:** `main` @ 5553801c (includes the CSP stale-balance fix Dean already ran and pushed)
**Reviewed by (voiced team lenses, per `overview.md`'s virtual-team convention):** Ian signs off on the scoring/gate logic; the weights themselves (`CSP_SCORE_WEIGHTS`) are untouched, per that file's own note that they're reserved for his review.

## Root cause (confirmed, not guessed)

Traced the exact math for the AAPL 400-strike example (credit $6,097.50, requiredCash $40,000, score 78):
- CSP's score gives Open Interest only 2 of 100 points and POP only 10 of 100 points.
- ROC (period + annualized) is worth 25 of 100 points, and was computed from the **full bid price**, which for a deep-ITM put is mostly intrinsic value — the cost of near-certain assignment, not option income.
- Five components (ROC×2, IVR, liquidity-width, technical) maxed out purely from that inflated ROC and the strike's other attributes, worth 73 of 78 points, while POP=0/OI=0/OTM=negative dragged the other three to 0.
- Separately, `isBestOpportunitiesEligible` never checked delta-band or OI at all — only market qualification and account funding — so nothing stopped an unfillable, near-certain-assignment contract from winning the top slot on score alone.
- Separately again: the compact CSP result-card row had a code branch that routed CSP into a trimmed IVX/EM-only box, skipping the labeled POP/ROC/Delta/OTM/OI block every other strategy gets. That block already had CSP-specific handling built into it (see its `(c.strategy === 'CSP' || ...)` checks); it was simply never reached.

## What changed

1. **Extrinsic-value ROC for scoring only** (`lib/scans/csp-finder.ts`, `lib/scans/types.ts`, `app/screener/page.tsx`): each CSP candidate now also carries `cspExtrinsicValuePerContract` / `cspExtrinsicRoc` / `cspExtrinsicAnnualizedRoc` — the put's mid price minus its intrinsic value (`max(0, strike - underlying price)`), floored at 0. The score's premium-efficiency dimension is fed these instead of the full cash-flow ROC. **`credit`, `roc`, `annualizedRoc`, and everything shown on the card are completely unchanged** — the trader still sees and receives the real premium; only the score's judgment of how "efficient" that premium is changed.
2. **Best-Opportunities gate** (`lib/scans/cspQualification.ts`, plus its two call sites): `isBestOpportunitiesEligible` now hard-requires delta-in-band and **literal zero** open interest exclusion. I initially scoped this too broadly — hard-gating on "OI below the preferred minimum" — which broke two pre-existing, deliberately-approved acceptance fixtures (AMD's 405 strike, real OI of 245, below the 500 preference but genuinely tradeable, and one NKE strike similarly). Caught that against the existing test suite and narrowed it: a contract below the round-number OI preference stays exactly as before (visible, advisory warning, still eligible); only literal zero OI (no market at all) is now excluded.
3. **CSP card parity** (`app/screener/page.tsx`): removed the branch that diverted CSP away from the shared POP/ROC/Delta/OTM/OI stat block. CSP cards now show the same labeled, color-coded stats spreads and CC do, plus the same IVX/EM box (which was already there, and is unchanged).

## Verification

- `tsc --noEmit` with the real `tsconfig.json` (es5): 0 errors.
- New/updated tests, run together: **28 files, 291 passed, 2 skipped, 1 todo, 0 failed.** Includes:
  - `lib/scans/__tests__/cspExtrinsicRoc.test.ts` (new, 8 tests): reproduces the exact AAPL-400 numbers from the screenshot; proves extrinsic ROC drops sharply while `credit`/`roc`/`requiredCash` stay exactly as they'd actually pay out; proves extrinsic value floors at 0 and degrades safely with no underlying price.
  - `lib/scans/__tests__/cspQualification.test.ts` (6 new cases): the zero-OI gate, the delta-band gate, and — critically — that nonzero-but-below-preference OI (the AMD 405 case) stays eligible.
  - `app/screener/__tests__/CspCandidateDiscovery.test.tsx` (1 new test, plus the pre-existing AMD/NKE acceptance tests, unmodified and still passing): confirms the real rendered page now shows POP/Delta/Exposure/OTM/OI for every qualified AMD card, with the genuine per-contract OI values (107/245/333/409), and that the AMD/NKE acceptance fixtures' existing expectations are undisturbed.
- Full repo-wide `vitest run`: in progress at hand-off; will confirm before this ships.

## A note on process

I initially built these three fixes on a stale local checkout — before pulling the CSP stale-balance fix you'd already run and pushed. Caught it before anything was delivered: stashed the new work, fast-forwarded to your pushed commit, and reapplied the stash. It auto-merged cleanly with zero conflicts (the DTE/Delta-filter and cash-override parts of my working tree were byte-identical to what you'd already pushed). Re-ran `tsc` and the full targeted test set against the correct base before writing this report.

## Open items

- Ian: the reweighting question (should OI/POP carry more than 2/10 points) is still open. I did not touch `CSP_SCORE_WEIGHTS` — only the ROC *input*, per Ian's explicit instruction to fix the input, not the dial.
- Diane: no new UI was introduced (card parity is existing-pattern reuse), so no mock was needed.
