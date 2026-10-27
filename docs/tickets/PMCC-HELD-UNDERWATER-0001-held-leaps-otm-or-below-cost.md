# PMCC-HELD-UNDERWATER-0001 — Held LEAPs that are out of the money or below cost still get short-call candidates

## Status

**v3. Team aligned 2026-10-27 (Ian, Paul, Alan, Quinn, Diane for 0001A, Dane). 0001A built; 0001B waits on Diane's mock and Alan's fixtures.**

## Problem

A held LEAP that is OTM or below cost showed zero short-call opportunities. Example: NFLX $70C 2027-09-17, cost about $20.85 per share, spot about $62.70. Two hard blocks:

1. `LONG_NOT_ITM` (`lib/scans/pmccPairing.ts`, `filterLegs`) had no held-LEAP exemption, while delta, DTE, OI and quote were already exempt for a held long.
2. The held breakeven floor `Ks + bid > Kl + avgOpen` (floor = $90.85 here). Handled in 0001B.

Dane also found that the held card's breakeven, width-minus-debit and annualized ROI used today's LEAP ask, not what the owner paid (NFLX showed about $77 instead of about $90).

## Split (Paul)

- **0001A (built):** ITM exemption for held LEAPs; "OTM LEAP · Δ" chip; separate long-leg blocker line next to the earnings or delta banner; excluded contracts keep their bid; cost-based breakeven, width minus cost, credit / net cost and ROI on held cards.
- **0001B (not built):** held-floor scan control and Recovery mode notice. Needs Diane's mock and Alan's golden fixtures.

## Rulings

- **Ian:** held longs skip the ITM gate (entry rule only; new-entry longs stay strict). 0001B control has two options only: Cost basis (default) | LEAP strike. No "Off": it would allow shorts below the LEAP strike, which need collateral, and Dean does not use margin. Recovery mode is for held LEAPs only and must state the realized outcome if assigned. Not a recommendation.
- **Alan:** on held cards with a usable cost basis, per share: net cost = avgOpen − short credit; breakeven = LEAP strike + net cost; width minus cost = (Ks − Kl) − net cost = result if the short is assigned and the LEAP exercised (before fees, ignores residual time value). Label it "if assigned and LEAP exercised", never as an expected P/L. Falls back to market economics when the basis is unusable (`COST_BASIS_UNAVAILABLE` unchanged).
- **Quinn:** one change covers `pairPmccCandidates`, `evaluatePmccPairOnDemand` and the server held trade review, because they share `filterLegs` and `evaluatePair`. `PMCC_DECISION_POLICY_VERSION` does not bump (pairing and display only). 0001B adds an optional criterion where missing = Cost basis, so no bump there either. The Mock 3c held-outcome copy is untouched.
- **Diane (0001A):** reuse the existing chip and banner pattern; no new component.

## Built in 0001A

- `lib/scans/pmccPairing.ts`: ITM exemption for held longs; `heldCostBasisMetrics`; excluded legs carry `bid`/`ask`.
- `lib/scans/pmccTypes.ts`: optional `PmccPairMetrics.costBasisPerShare`, optional `PmccLegRejection.bid`/`ask` (older restored sessions still validate).
- `lib/scans/pmccHeldUnderwaterDisplay.ts` (new): `heldLeapOtmTag`, `selectLongLegBlockerLine`, `excludedContractPremiumText`.
- `app/screener/page.tsx`: chip, separate long-leg line, premium on excluded contracts, held wording in the structure-economics panel, profit-if-closed uses cost basis for held.
- `lib/scans/__tests__/pmccHeldUnderwater.test.ts` (new): NFLX golden case, profitable ITM held LEAP, new-entry OTM long still rejected, unusable and multi-lot basis, unit guard, display selectors.

## Not changed

- Floor `Ks + bid > Kl + avgOpen`: still applies (0001B). After 0001A an underwater held LEAP shows its short-call candidates as "Floor not met" cards with premiums, not as a blank audit card.
- New-entry LEAP rules; the new-entry PMCC order modal (held pairs never reach it).
