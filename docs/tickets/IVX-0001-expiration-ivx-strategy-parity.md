# IVX-0001 — Expiration IVX Strategy Parity

**Status:** Ready for implementation  
**Implementation owner:** Dane  
**Product:** Ian  
**Requirements:** Paul  
**QA/data review:** Quinn  
**Design review:** Diane

## Problem

Trade Edge already receives broker IVX by expiration (`expirationIvxMap`), but its use is inconsistent by strategy. CSP now shows and post-filters the IVX for the exact contract expiration. Other strategy surfaces either show only a generic IVX, keep the expiration value only on an internal candidate, or have no post-scan IVX control.

This makes IVR/IVX comparisons inconsistent and can cause the displayed IVX to describe a different horizon than the option being considered.

## Product decision

1. **IVR and Expiration IVX are context, not a universal trade gate.** No raw IVX threshold may qualify, disqualify, or directly change a strategy score in this ticket.
2. Every option candidate that is displayed to the trader shows `IVR / Expiration IVX`, where Expiration IVX is mapped to that candidate's actual expiration.
3. Where a strategy has post-scan result controls, provide an optional `Expiration IVX ≥` view filter. It narrows already-returned results only; it never triggers a rescan or alters canonical qualification/accounting.
4. Missing broker evidence is shown as `Unavailable`; do not substitute a generic 30-day IVX for an expiration-specific value.
5. The CSP implementation is the reference behavior. This ticket extends parity without changing CSP’s existing behavior.

## Exact mapping by strategy

| Strategy | Expiration that supplies IVX |
|---|---|
| Cash-Secured Put | Short put expiration |
| Covered Call | Short call expiration |
| Bull Put Spread | Shared spread expiration |
| Bear Call Spread | Shared spread expiration |
| Iron Condor | Shared structure expiration |
| PMCC | Proposed short-call expiration, never the held LEAPS expiration |
| LEAPS | Candidate long-call expiration |

## Scope

### 1. Correct result-level data mapping

- Populate the result-level IVX used by cards and controls from the exact expiration shown on the result.
- For BPS, BCS, and IC, promote the already-available `bestCandidate.expirationIvx` to the displayed result value rather than showing a generic underlying IVX.
- Preserve existing exact-expiration mappings for CSP, CC, PMCC short calls, and LEAPS candidates; correct them only if a test demonstrates a mismatch.
- Carry expected move only when it is computed from the same exact expiration IVX and displayed candidate DTE.

### 2. Presentation

- Render `IVR / Expiration IVX` on each applicable strategy card or result-detail surface.
- Use `Unavailable` when the broker does not return an IVX for that expiration.
- Do not label a generic or 30-day underlying IVX as `Expiration IVX`.
- PMCC language must make clear that the value applies to the proposed short call.

### 3. Post-scan controls

- Add `Expiration IVX ≥` preset chips to each eligible post-scan control surface:
  - Filtered spreads (BPS, BCS, IC)
  - Covered Calls
  - PMCC
  - LEAPS result controls
- Reuse the CSP preset chip behavior and active-filter/removal/reset behavior where the UI architecture allows.
- Apply the filter only to results with the appropriate exact-expiration IVX. A missing value must fail a positive IVX floor, rather than passing as unknown.
- Keep generic rank-mode behavior unchanged unless that strategy already exposes post-scan filters in rank mode.

## Non-goals

- No pre-scan IVX minimum, maximum, or hard validation rule.
- No automatic recommendation or scoring adjustment based solely on raw IVX.
- No synthetic fallback from IVR, IVX30, historical volatility, or another expiration.
- No change to CSP’s existing Expiration IVX display/filter behavior.
- No changes to option-chain acquisition beyond using already-returned expiration IVX evidence.

## Acceptance criteria

1. **Correct horizon**
   - Given a candidate whose expiration has an IVX entry in broker metrics,
   - when the result is rendered,
   - then `Expiration IVX` equals that entry—not generic IVX or IVX30.

2. **Honest missing data**
   - Given no expiration IVX entry for a displayed candidate,
   - when the result is rendered,
   - then the value is `Unavailable`.
   - Given a positive `Expiration IVX ≥` filter,
   - then that unavailable candidate is not shown in the filtered view.

3. **Filter-only behavior**
   - Given results with different expiration IVX values,
   - when the trader selects `Expiration IVX ≥ 30%`,
   - then only results at or above 30% remain in the displayed view, while session qualification, result accounting, and scan data remain unchanged.

4. **Strategy-specific PMCC mapping**
   - Given a PMCC with a long LEAPS expiration and a different short-call expiration,
   - when the result is rendered or filtered,
   - then it uses the proposed short call’s expiration IVX.

5. **CSP regression**
   - Existing CSP exact-expiration IVX display/filter tests continue to pass unchanged.

## Validation

- Unit tests for exact-expiration selection and unavailable handling for BPS, BCS, IC, CC, PMCC, and LEAPS.
- Component tests for each post-scan IVX control, active chip, reset action, and positive-floor handling of unavailable values.
- Integration tests that a post-scan IVX filter changes only rendered results, never scan-session accounting or qualification.
- Visual review of labels at desktop and narrow width.
