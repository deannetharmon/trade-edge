# PMCC-HELD-BREAKEVEN-0001 — Held-LEAP short calls have no breakeven floor

## Status

**Logged; approved by Dean 2026-09-24. Not built.** Bug, **P1** (Ian). Paul rated it P0; both agree it goes first. Found during the `SCAN-ALIGN-0001` review (slice A). Units confirmed 2026-09-24 (decision 1). Build still needs decision 4 settled, Alan's fixture sign-off and Ian's logic sign-off.

## Problem

When a PMCC scan pairs a short call against a LEAP the trader already holds, no breakeven test runs at all. `lib/scans/pmccPairing.ts:244-247` skips both entry-price checks (`NET_DEBIT_NOT_POSITIVE`, `NET_DEBIT_NOT_BELOW_WIDTH`) when `isHeldLong`. The only strike floor left is `SHORT_NOT_OTM` (strike above the stock price, line 168). A held-LEAP short call whose assignment would lock in a loss can therefore qualify.

The cost the floor needs never reaches pairing. `HeldPmccLongCandidate` (`lib/scans/pmccHeldLeaps.ts:8-17`) has no cost field, and the held long's price is the live chain ask (`pmccPairing.ts:172`). That ask is used even when the quote is too wide, because the usability check is skipped for held longs. The broker's `average-open-price` is already parsed onto position legs as `avgOpenPrice` (`lib/portfolio-data/acquisition.ts:1317`).

## User value

Held-LEAP mode is the live income path. The screener should never recommend a short call that locks in a loss if assigned. Covered calls already enforce this with a cost-basis floor (`findBestCoveredCall`, `covered-call-finder.ts:317-319`).

## Scope

- Carry the held LEAP's per-share cost (`avgOpenPrice`) on `HeldPmccLongCandidate` into pairing.
- Held-mode floor, per share: **`Ks + shortBid > Kl + avgOpenPrice`** (Ian and Alan agree). Strict inequality with a cents epsilon.
- Fail closed: when the cost is unknown, the pair does not qualify, and the trader sees an explicit "cost basis unavailable" reason, not an empty result.
- The new-entry formula is unchanged: `Ks > Kl + (long ask − short bid)`, i.e. debit < width. This is the canonical PMCC breakeven.

## Non-goals

- Making `requireDebitBelowWidth` non-switchable (`SCAN-ALIGN-0001` slice E).
- Changing `pmccStartPrice`. It stays a deliberately conservative estimate with no short credit. Using `avgOpenPrice` for its held-mode input is a follow-up.
- `LONG_NOT_ITM` and `INVALID_EXTRINSIC` still apply to held longs (`pmccPairing.ts:167,183`). A held LEAP that has gone OTM drops out silently. That is a separate finding, logged in `SCAN-ALIGN-0001`.

## Decisions (Ian, 2026-09-24) and open items

1. Units: **confirmed per share (Dean, 2026-09-24), against a real TastyTrade payload (HAR capture).** NFLX Long 70C 2027-09-17, one lot: `average-open-price` = `"20.85"` (a string), `multiplier` = `"100.0"`, `close-price` = `"13.24"`. 20.85 x 100 = the $2,085 entry debit TradeEdge shows; 70 + 20.85 = the $90.85 breakeven; TastyTrade's P/L Open (-$753) agrees. Fees: assumed excluded (a clean fill-price value), observed on one payload only. Notes: the API returns a string, so fixtures should use strings; do not infer direction from `cost-effect` (it read "Credit" on this long) and use `quantity-direction`. Not covered by this payload: multi-lot averages and a zero or missing basis, so Alan's fixtures must cover those. Keep the unit guard: a per-contract-scaled value (x 100) must not pass silently.
2. Multi-lot held LEAPs: **decided.** Quantity-weighted average only when all lots share strike and expiry and each has a valid basis; otherwise fail closed.
3. Fail closed when `avgOpenPrice` is null, non-finite or <= 0 (a zero basis from assignment or transfer would pass trivially). **Decided.**
4. Where the "cost basis unavailable" reason shows (rejected reason code vs. near-miss), and its copy. **Still open.** Diane's proposal: rejection reason plus a caption on the LEAP row, and a banner line when it is why a held LEAP shows zero shorts.

## Acceptance criteria

- A held-LEAP pair where `Ks + shortBid <= Kl + avgOpenPrice` does not qualify and carries a named reason code.
- A held-LEAP pair with `avgOpenPrice` null or non-finite does not qualify and shows "cost basis unavailable."
- New-entry pairing results do not change.

## Golden fixtures (Alan)

- **F4a (new entry, unchanged):** Kl 80, long ask 24.10, Ks 105, short bid 1.60 → debit 22.50 < width 25 → qualifies. Same legs with Ks 102.50 → 22.50 = 22.50 → rejected (strict).
- **F4b (held):** Kl 80, avgOpen 26.00, live ask 20.00, Ks 105, short bid 1.00 → 106 > 106 is false → rejected. (A live-ask test, 101 > 100, would wrongly pass.) Same with avgOpen null → rejected with "cost basis unavailable."

## Validation

Engine tests on the fixtures above, the existing PMCC pairing tests, then a Vercel preview build.

## Rollout

The floor is engine-only. Before the PMCC registry migration (`SCREENER-CONFIG-0001B` follow-on).
