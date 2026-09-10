# CSP-0003 — Cash-Secured Put Control Semantics and Filter Clarity

**Status:** Ready for implementation  
**Product decision:** Trade Edge shows the complete quote-valid CSP universe in the chosen DTE window and distinguishes recommendations from post-scan views.  
**Scope:** CSP scan modal and CSP post-scan result controls only.

## Problem

Several CSP controls use language inherited from multi-leg spreads or describe a rule that is no longer applied as a hard filter. This makes it unclear which values guide the recommendation, which values narrow the visible results, and which values have no effect.

Examples:

- “Credit Ratio” duplicates CSP cash-on-cash return.
- POP is currently a delta-based estimate, but remains useful as a post-scan way to narrow a broad universe.
- “Relevant-leg OI” is unnecessarily generic for a CSP; the relevant leg is always the short put.
- The pre-scan delta and OI values are preferences/ranking inputs, not reasons to conceal contracts.
- The visible absolute `Max bid/ask width` input conflicts with the actual relative liquidity policy: strong through `max($0.10, 10% of midpoint)`, borderline through 15% of midpoint. The input must not imply it controls a rule when it does not.

## Product decisions

1. A CSP scan continues to show every quote-valid put in the selected DTE range by default. Preferred delta, OI, IVR, liquidity, earnings, and capital states are displayed as qualification, ranking, or eligibility evidence; they do not silently remove a contract unless the trader explicitly enables an affordable-only view.
2. **Keep POP as a post-scan CSP filter.** Label it `POP (delta-based estimate)` so the trader understands it is not an independent broker/model probability.
3. **Remove CSP Credit Ratio** from post-scan chips and sorting. For a CSP, `credit ÷ required cash` is the same value as period ROC/cash-on-cash return expressed in a different unit.
4. Keep CSP ROC, but label it `Cash-on-cash return` in post-scan controls and tooltips. It means premium received divided by reserved assignment cash for the selected expiration; it is not annualized.
5. Rename the CSP-only post-scan OI label to `Short-put OI`.
6. Preserve OTM as a post-scan filter. It measures strike cushion versus current underlying price and is distinct from delta.
7. Keep post-scan IVR for multi-symbol scans, but label it `Underlying IVR`. It may not distinguish strikes for a single symbol.
8. Rename scan-modal controls to state their actual purpose:
   - `Preferred delta range` (instead of Min/Max delta)
   - `Preferred OI for ranking` (instead of Preferred OI)
   - `Preferred IVR floor for ranking` (instead of Min IVR %)
   - `IVR hard cap` (instead of Max IVR %)
9. Remove the pre-scan absolute `Max bid/ask width` input unless its value is wired into the actual relative liquidity classifier. For this ticket, remove the inactive input and show one non-editable liquidity-policy explanation.

## Required UI changes

### CSP scan modal

- Retain DTE range, preferred delta range, preferred OI, IVR ranking floor, IVR hard cap, capital view, and the non-editable relative liquidity-policy explanation.
- Do not call the modal delta/OI/IVR-floor settings hard filters or qualification gates.
- Do not display an editable maximum bid/ask width while the classifier uses the fixed relative policy.

### CSP result controls

- Replace `POP` with `POP (delta-based estimate)`.
- Remove `Cr Ratio` chips and the `Credit $` sort choice.
- Replace `ROC %` with `Cash-on-cash return`.
- Replace `Relevant-leg OI` with `Short-put OI`.
- Replace `IVR` with `Underlying IVR`.
- Retain OTM, DTE, score, cash-on-cash return, POP estimate, short-put OI, and underlying IVR as applicable controls.
- Update control descriptions/tooltips to say whether each value is a ranking preference, a post-scan view filter, or descriptive evidence.

## Non-goals

- Do not replace the delta-based POP estimate with a broker/model probability in this ticket.
- Do not change CSP scoring, earnings treatment, capital eligibility, or relative liquidity thresholds.
- Do not widen the fetched DTE range or fetch every expiration in the chain.
- Do not modify spread, covered-call, PMCC, or LEAPS controls except where shared components require a neutral implementation detail.

## Acceptance criteria

1. **No duplicate CSP return filter**
   - Given CSP result controls,
   - when the trader opens the filter/sort row,
   - then Credit Ratio and Credit $ are absent, and Cash-on-cash return is available.

2. **Honest POP meaning**
   - Given CSP result controls,
   - when the trader sees the POP control,
   - then it is labeled `POP (delta-based estimate)` and can narrow already-returned CSP contracts without changing the pre-scan discovery range.

3. **CSP-specific terminology**
   - Given a CSP scan,
   - when OI or IVR controls are shown,
   - then they read `Short-put OI` and `Underlying IVR` respectively.

4. **No inactive liquidity control**
   - Given the CSP scan modal,
   - when liquidity settings are shown,
   - then the modal does not expose an editable absolute width that has no effect, and it accurately states the active relative liquidity policy.

5. **Preference versus exclusion clarity**
   - Given a CSP outside the preferred delta/OI/IVR-floor settings,
   - when the scan completes with affordable-only disabled,
   - then the contract remains visible with an honest reason and is not presented as a primary recommendation.

## Validation

- Component tests for CSP-only labels and the absence of Credit Ratio/Credit $.
- Tests that POP remains available as a post-scan result filter and is labeled as delta-based.
- Tests that opening the CSP modal does not render an inactive absolute width input.
- Regression tests that an out-of-preference candidate remains visible in the result set and receives the proper reason.
