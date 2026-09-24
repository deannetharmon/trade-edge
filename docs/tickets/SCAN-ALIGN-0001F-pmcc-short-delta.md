# SCAN-ALIGN-0001F — PMCC short-delta: control polish (F1) and rule flip (F2)

## Status

**F1 accepted by Dean 2026-09-24. F2: direction accepted (PMCC delta becomes a hard filter), held until after F1; Dean revisits timing then. Not built.** F1 is build order slot 8 and needs mock 1 approved (Diane). F2 needs mock 3, LEAPS-ADVISOR-0001B built or re-scoped, and Dean's timing decision.

## Problem

Covered call treats delta as a hard limit; PMCC treats it as a preference and keeps out-of-window shorts with a warning (`NEW_SHORT_DELTA`), which overrides the trader's window.

## Scope

**F1 (PMCC delta control polish):** the control already exists (`shortDeltaMin`/`shortDeltaMax`, "Min Δ"/"Max Δ", 0.10–0.40). Add preset chips, hint text and a receipt row. Ships before or with F2, never after.

**F2 (deferred rule flip):** remove `role !== 'short'` (`pmccPairing.ts:162`); bounds inclusive; `NEW_SHORT_DELTA` becomes unreachable (remove or mark defensive); the "Delta guides rank" note goes. Held mode can end with zero shorts, so the empty-result banner (mock 3) must name the binding filter, with an "Adjust short delta" action.

## Non-goals

- Bundling F2 with any other engine flip. F2 gets its own revertable test flip.

## Acceptance criteria (F2, Alan)

- |delta| = min and = max pass; negative delta via `abs`; null rejects. `pmccStartPrice`'s delta-cap assumption becomes true.

## Notes

If F2 is still held at the PMCC registry migration, the registry records delta as a deliberate difference (CC hard, PMCC preference). `PMCC-HELD-LONG-FLAGGED-0001` shares mock 3 and is approved after F1.

## F2 approved to build (Dean, 2026-09-24) and design rulings

**Dean (2026-09-24): "Do F2 now"; one-line reason on the held card is fine (no button, no funnel until 0001C); `LEAPS-ADVISOR-0001B` waived (not a dependency: F2 changes only the pairing filter).** Paul: scope approved; Ian: approved with edits A-D; Alan: fixtures below. F2 ships as its own revertable flip.

**Code change (Alan):** `pmccPairing.ts` ~:167 `role !== 'short' && !isHeldLong && (delta < min || delta > max)` becomes `!isHeldLong && (delta < min - EPS || delta > max + EPS)` (EPS = 1e-9 on the bounds; PMCC only; CC untouched); `isHeldLong` is true only for the long role so shorts are never exempt; short-leg reason carries observed value and window (`reason('DELTA_OUT_OF_RANGE', 'Short delta 0.41 outside 0.20-0.35')`); **reuse the existing `DELTA_OUT_OF_RANGE` code** (already in `PMCC_FAILURE_CODES` and the plumbing map; a new code would need edits in three places). null/undefined/NaN/Infinity delta already reject `INSUFFICIENT_DATA` (fixtures lock it in; `:218` fallback guarantees reasons are never empty). **`NEW_SHORT_DELTA` is deleted (Ian edit A), not kept defensive.** The "Delta guides rank" modal note, the stale comments at `pmccPairing.ts:153-166` and `pmccConfig.ts:12-14` go/update (Ian edit B). `pmccStartPrice.ts`, `pmccConfig.ts` defaults (0.20-0.35, bounds 0.10-0.40) and `covered-call-finder.ts` unchanged. Default window stays 0.20-0.35 and matches no chip, so no chip looks selected at default (Ian edit D; do not change the default). LEAP long legs are not delta-filtered by this window.

**Server/on-demand review path (decided 2026-09-24):** `/api/pmcc-trade-review` and `serverTradeReview.ts` use the default window; a pair scanned under a wider user window would be rejected at order time. Thread the scan's `shortDelta` window through the two routes and `PmccTradeModal` like C2 did for `shortWidthCeiling`; an older snapshot without it uses the default. `pmccPairOnDemand` stays unfiltered (the trader picks the contract explicitly).

**Held zero-shorts reason (reduced, Dean/Ian/Paul):** on the existing held card, one outcome line `No short calls within your delta window ({X} to {Y}). Adjust Min/Max delta.` plus a real reason (`{N} shorts fell outside the window`); never "no short calls found". Precedence: cost-basis unavailable, then earnings-removed, then delta. Shown ONLY when delta actually removed candidates and delta was the sole removal reason for at least one short (a short that failed delta and another filter does not make delta "binding"; an empty chain or OI/quote/DTE-emptied chain does not blame delta). X and Y print with two decimals from the scan's snapshot criteria (`criteria.shortDelta`), not live control state. Data: short `legRejections` containing `DELTA_OUT_OF_RANGE` (delta-only vs delta-plus-other split), total considered = `counts.eligibleShortLegs` + short rejections; a small pure helper beside `pmccHeldOutcomeDisplay.ts` modeled on `heldOutcomeForEarningsRemoval`. New-entry scans: no new line (Ian); the per-symbol reject reason still records `DELTA_OUT_OF_RANGE` for audit.

**Fixtures (short leg, window 0.20-0.35):** 0.20 eligible; 0.35 eligible; 0.199 reject `DELTA_OUT_OF_RANGE`; 0.351 reject; -0.30 eligible (abs); -0.36 reject; null/undefined/NaN/Infinity reject `INSUFFICIENT_DATA` with reasons.length > 0 and the exact code; 0.3500000001 eligible (EPS); 0.3500001 reject; 0.35 vs a max built as 0.2 + 0.15 eligible; LEAP long 0.95 or 0.50 still rejects `DELTA_OUT_OF_RANGE` in new-entry mode; held mode: held long 0.95 stays eligible, 0.45 short rejected, 0.25 short retained; held mode with every short out of window: `eligibleShortLegs` = 0, no qualified pair, the held card shows the delta line (not generic).

**Tests that flip:** `pmccPairing.test.ts:137` (held, window 0.20-0.30, 0.32 short now rejected; expected [1090,1080] becomes [1090]; retitle) and `:167`/`:174` (0.45 short now rejected with `DELTA_OUT_OF_RANGE`, invert both); `pmccDecision.test.ts:83`/`:101` (asserted the `NEW_SHORT_DELTA` warning: rewrite to assert rejection at pairing; `:107` pass case unchanged); `pmccProduction.test.ts:83-87` comment stale; `pmccHeldOutcomeDisplay.test.ts:130,161,220` stay green. Verify by criteria object: `PmccResultCardFields:310`, `pmccStartPrice`, `scanAlignC1OiPolicy`, held-breakeven tests using short 0.25.

**Known gap (carry to the PMCC registry migration):** F1's scan receipt row was dropped (no PMCC receipt component), so a delta window persisted from an older scan (`LS_PMCC_DTE`) now hard-filters with no scan-level receipt showing it. The modal shows the saved values on open and the held card shows the window when it applies. Also check `lib/leaps-position-intelligence/policy.ts`, which imports `PMCC_SHORT_DELTA_MIN/MAX` from the same defaults: confirm it does not rely on out-of-window shorts surviving pairing.
