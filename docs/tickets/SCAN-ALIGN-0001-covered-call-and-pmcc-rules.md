# SCAN-ALIGN-0001 — Align covered-call and PMCC short-call rules

## Status

**Draft.** Ian decides rule by rule. Raised by Dean (2026-09-23): covered calls and PMCC "should look identical, one against a stock, the other against a LEAP."

## The layout should be identical; the rules are not

Both scans now share one skeleton: the same modal shell, section order, tags, and receipt. What differs is what the engine does with the **short call**, and several differences look accidental.

| Rule (the short call) | Covered call | PMCC | Source |
|---|---|---|---|
| Delta | Hard limit; outside is never a candidate | Preference; outside is kept, with a warning (`NEW_SHORT_DELTA`) | `isEligibleCcLeg`; `pmccPairing.ts` (Ian's corrected position, PMCC-HEALTH-CHECK-0001) |
| Open interest | Advisory: warned, never excluded | Hard reject below the minimum (`OPEN_INTEREST_BELOW_MINIMUM`) | `buildCcSpreadCandidate`; `pmccPairing.ts` |
| Bid/ask | Absolute dollars per share (default $0.20) | Relative percent (5 acceptable, 10 qualifying) plus quote age and market session | `isEligibleCcLeg`; `pmccQuoteQuality.ts` |
| Strike floor | At or above stock price, and above cost basis when known | Strictly above the stock price | `findBestCoveredCall`; `SHORT_NOT_OTM` |
| Earnings | Excludes a call that expires on or after earnings | Context only | `isEarningsSafeForDte`; `pmccProduction.ts` |
| IV rank | Not used | Context only | both |
| Near-misses | None retained | Qualified and near-miss pairs retained | `pmccPairing.ts` |
| Quantity | Share capacity (covered contracts) | The held LEAPS position | capacity vs. held-LEAPS discovery |

The last two rows are genuine (a stock position and a LEAP are different assets). The first five are the same short call with different policies.

## Decisions for Ian (one per row)

1. **Delta:** align covered calls to PMCC (preference with a warning), or PMCC to covered calls (hard limit)? PMCC's rule is the more recent one.
2. **Open interest:** OI-LIQUIDITY-CHOICE-0001 removed OI from the covered-call gate as "stricter than spreads without a principled reason." The same reasoning applies to PMCC's short leg. Align PMCC to advisory?
3. **Bid/ask:** one policy for both. Relative percent scales with premium; absolute dollars do not. Or offer both.
4. **Strike floor:** at-the-money allowed or not.
5. **Earnings:** a short call spanning earnings carries the same assignment risk either way. Exclude for both, warn for both, or leave as is. (Related: with no earnings date on file, both covered calls and CSP let the candidate through.)

## After the decisions

Each accepted change is a small policy ticket with its own test flip, made before the PMCC migration so the PMCC registry starts from a consistent set of rules. Where a difference is deliberate, the registry keeps it and the tags show it.
