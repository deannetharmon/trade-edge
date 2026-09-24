# CSP-IVR-0001 — Missing IVR must not pass the CSP cap

## Status

**Approved by Dean 2026-09-23 (Ian's recommendation). Built 2026-09-23 (Dane); see [the implementation report](../implementation/CSP-IVR-0001-and-csp-oi-default-implementation-report.md).** Engine-policy change, separate from `SCREENER-CONFIG-0001A`.

## Problem

CSP is undefined-risk, and the IVR hard cap (70) is the guard against selling into an unverifiable volatility environment. When a symbol's IV rank was unavailable, the check returned a warning ("Not available") and the symbol passed, so a cap that could not be verified let the candidate proceed.

## Behavior

When a symbol's IV rank is unavailable, the cap fails closed:
- Every candidate for that symbol is classified `DISQUALIFIED_IVR_UNAVAILABLE`, a state of its own. It is not folded into `DISQUALIFIED_IVR` (rank known and above the cap): "above the cap" and "could not be checked" are different claims and stay separate through to the screen.
- The candidates are **visible, not dropped.** They appear in the Disqualified audit under the volatility-risk category, each with the reason "IV rank is unavailable, so the IVR cap cannot be verified (undefined risk)."
- The result receipt says how many symbols were affected.
- Precedence is unchanged: earnings inside expiration, then IVR above the cap, then IVR unavailable, then liquidity.

An IV rank below the floor is still guidance only, and a known in-band IV rank still qualifies.

## Scope

- `lib/scans/cspIvrPolicy.ts` reports `unavailable`; `lib/scans/csp-finder.ts` takes `ivrUnavailableDisqualified` (off by default, so any other caller keeps its behavior; the Screener is the only caller and turns it on).
- The new state is added to `CspMarketQualification` and to the cached-session validator in `lib/screener/scanSession.ts`. Without the validator entry, a saved scan containing the state would be rejected as invalid.
- The Screener adds the specific reason to each candidate's fail reasons.
- Registry copy, the scan summary, and the result receipt now state the rule.

## Tests

- Engine (`cspConfigTruthfulness.test.ts`): unavailable IVR is `fail` with `unavailable: true`; every candidate is disqualified with its own state; distinct from the above-cap state; earnings still wins; off by default.
- State model: `cspQualification.test.ts` (never market-qualified) and `scanSession.test.ts` (validator accepts the state and rejects an unknown one; removing the validator entry fails the test).
- Page level (`CspCandidateDiscovery.test.tsx`): a symbol with no IV rank shows 0 qualified and 2 disqualified, the volatility-risk exclusion, the receipt line, and the contract-level reason when the audit is opened. A known in-band IV rank still qualifies.

## Open follow-up

Ian: confirm the same treatment for any other undefined-risk strategy. None is scanned today.
