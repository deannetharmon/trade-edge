# PMCC-0003 Package A — Data Availability Review

**Status:** Foundation review; no production activation

**Reviewed:** 2026-09-11

## Existing confirmed inputs

| Evidence | Current source/path | Package A disposition |
|---|---|---|
| Option identity, expiration, strike | Tastytrade nested chain / OCC symbol | Reusable; exact identity remains mandatory |
| Bid, ask, delta, open interest | Tastytrade market-data-by-type | Reusable with current null/freshness handling |
| Quote timestamp / delayed flag | Tastytrade response where supplied | Reusable; missing remains explicit |
| Underlying price | Existing `getQuote` acquisition | Reusable |
| New-pair natural execution | Long ask minus short bid in `pmccPairing.ts` | Preserved as conservative qualification input |
| Net debit, width, WMD cushion, net delta | `pmccPairing.ts` | Reusable; PMCC-0003 adds a dormant recommendation threshold |
| Held long identity and account context | Portfolio snapshot / `pmccHeldLeaps.ts` | Reusable; original intent is not a gate |
| IV rank / expected earnings date | Existing market metrics | Context exists, but a null expected date is not complete evidence |
| Trend | Existing screener trend result | Reusable as separate evidence/gate; not silently added to score |

## Evidence not currently sufficient for a canonical claim

| Evidence | Gap | Required handling |
|---|---|---|
| Confirmed earnings timestamp | Existing field appears to be an expected date and may be null | Add a sourced acquisition cascade; null becomes `UNKNOWN` |
| Pending earnings range | Current result shape exposes one date, not confidence/range | Preserve source, as-of time, confirmation state, and bounded range |
| Provider coverage horizon | Not represented | Required before `NOT_SCHEDULED` may pass |
| Option volume | Not present in `PmccChainLeg` | Do not claim or gate on volume until acquired and timestamped |
| Aggregate Greeks beyond net delta | Current pairing contract retains delta only | Mark unavailable until exact leg inputs are supported |
| Dividend / ex-dividend evidence | Not part of the PMCC snapshot contract | Early-assignment claim remains unavailable until sourced |
| Fees | No canonical per-order fee contract identified | Do not fabricate; disclose exclusion from modeled economics |
| Future LEAPS value | No approved model/IV/rate/dividend contract | Scenario future mark remains unavailable and non-blocking |
| Modeled price improvement | Current qualification uses natural prices | Midpoint may be displayed, but no fill-improvement claim is authorized |

## Existing conflicts resolved by PMCC-0003

- Live `pmccScore.ts` is ROI/liquidity heavy.
- `pmccBestFit.ts` ranks short-call fit using a separate profile model.
- The root `PMCC_SPECIFICATION.md` described an unimplemented four-pillar model.
- PMCC-0003 is now the authoritative target policy; the older root document is marked historical.
- Package A introduces dormant canonical ranking contracts. It does not replace live ranking until Package D shadow evidence is approved.

## Package A safety conclusion

The repository has enough data to define and test workflow, cadence, LEAPS,
cushion, runway, cache, and normalized ranking contracts without changing
production behavior. Earnings acquisition, option volume, dividend evidence,
fees, aggregate Greeks, and theoretical scenario values require later data or
model work. Their absence must remain explicit; Package A does not invent them.
