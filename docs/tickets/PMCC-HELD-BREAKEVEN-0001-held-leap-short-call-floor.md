# PMCC-HELD-BREAKEVEN-0001 — Held-LEAP short calls have no breakeven floor

## Status

**Logged; approved by Dean 2026-09-24. Not built.** Bug, **P1** (Ian). Paul rated it P0; both agree it goes first. Found during the `SCAN-ALIGN-0001` review (slice A). Units confirmed 2026-09-24 (decision 1). Decision 4 closed by Dean 2026-09-24. Build is blocked until a real `quantity > 1` payload confirms the broker's `average-open-price` is the weighted average. If it cannot be confirmed, a held LEAP with `quantity > 1` fails closed as `COST_BASIS_UNAVAILABLE`. Fixtures drafted by Alan and reviewed by Ian 2026-09-24 (below); Ian signs off on the floor logic and codes with the loosened unit guard. Build still needs Alan's confirmation of the revised fixtures.

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
4. Where the "cost basis unavailable" reason shows (rejected reason code vs. near-miss), and its copy. **Closed (Dean, 2026-09-24), accepted as recommended.** Diane's proposal: rejection reason plus a caption on the LEAP row, and a banner line when it is why a held LEAP shows zero shorts.

## Acceptance criteria

- A held-LEAP pair where `Ks + shortBid <= Kl + avgOpenPrice` does not qualify and carries a named reason code.
- A held-LEAP pair with `avgOpenPrice` null or non-finite does not qualify and shows "cost basis unavailable."
- New-entry pairing results do not change.

## Golden fixtures (Alan, drafted 2026-09-24; Ian's changes applied)

All prices are per share. The floor compares in **integer cents** (`Math.round(x * 100)`), strict `>`. `avgOpenPrice` arrives from the broker as a **string**; fixtures use strings unless noted. The held result never depends on the live long ask.

**Spot:** every held row needs a spot with `Kl < spot < Ks` (`LONG_NOT_ITM` and `SHORT_NOT_OTM` still apply to held pairs, `pmccPairing.ts:167-168`, and an OTM long drops out before the floor is evaluated). Unless a row says otherwise use spot = midpoint of Kl and Ks (A1 to A3 and A6 to A13: 92.5; A4, A5, A15, A16: 80; A17: spot is irrelevant, the mixed-strike check fails first). **Check order, pinned: data validity, then unit guard, then floor.**

**Proposed reason codes** (names are proposals; style matches `NET_DEBIT_NOT_BELOW_WIDTH`). Both go in the `PmccFailureCode` union (`pmccTypes.ts:106-122`) with a message in `pmccAuditSummary.ts`:

- `COST_BASIS_UNAVAILABLE`: the held long's cost is missing or unusable. Do not reuse `INSUFFICIENT_DATA`; it sets the `insufficientData` flag (`pmccPairing.ts:258`) and the UI could not tell them apart.
- `SHORT_NOT_ABOVE_HELD_BREAKEVEN`: cost is valid and the floor is not met.
- Neither is a near-miss (`structurallyValid` at `pmccPairing.ts:248` treats only `NET_DEBIT_NOT_BELOW_WIDTH` as one). Tests pin that.

### Floor (held mode)

| # | Case | Kl | avgOpen | Live ask | Ks | Short bid | Expected |
|---|---|---|---|---|---|---|---|
| A1 | F4b: equality rejects (a live-ask test, `Ks > Kl + ask − bid`, i.e. 105 > 99, would wrongly pass) | 80 | "26.00" | 20.00 | 105 | 1.00 | 106.00 > 106.00 false → `SHORT_NOT_ABOVE_HELD_BREAKEVEN` |
| A2 | +0.01 passes | 80 | "26.00" | 20.00 | 105 | 1.01 | qualifies |
| A3 | −0.01 rejects | 80 | "26.00" | 20.00 | 105 | 0.99 | `SHORT_NOT_ABOVE_HELD_BREAKEVEN` |
| A4 | Real NFLX payload, equality (cents compare required: 2085 + 7000 = 9085 = 9000 + 85) | 70 | "20.85" | 13.24 | 90 | 0.85 | `SHORT_NOT_ABOVE_HELD_BREAKEVEN` |
| A5 | NFLX +0.01 | 70 | "20.85" | 13.24 | 90 | 0.86 | qualifies |
| A6 | Live ask must not matter | 80 | "26.00" | 5.00, then 60.00 | 105 | 1.01 | qualifies at both asks |
| A21 | Deep loss: every short rejects on the floor, not on data (spot **72**, so the LEAP stays ITM) | 70 | "30.00" | any | 95 | 2.00 | 97.00 > 100.00 false → `SHORT_NOT_ABOVE_HELD_BREAKEVEN` (not `COST_BASIS_UNAVAILABLE`) |

### Fail closed on basis (all → `COST_BASIS_UNAVAILABLE`, not qualified)

| # | Case | avgOpen values | Kl / Ks / bid |
|---|---|---|---|
| A7 | Missing | `null`, `undefined` | 80 / 105 / 1.00 |
| A8 | Zero (would trivially pass: 108 > 80) | `0`, `"0"`, `"0.00"` | 80 / 105 / 3.00 |
| A9 | Negative | `-5`, `"-5"` | 80 / 105 / 3.00 |
| A10 | NaN | `NaN` | 80 / 105 / 3.00 |
| A11 | Infinity | `Infinity`, `"Infinity"` | 80 / 105 / 3.00 |
| A12 | Unparseable string, including exponent and hex forms (Dean, 2026-09-24: reject) | `"abc"`, `""`, `" "`, `"26.00x"`, `"1e2"`, `"0x10"` | 80 / 105 / 3.00 |

A11 and A12 may be one table-driven test (Quinn's call). A13: `" 26.00 "` parses to 26.00 and qualifies at bid 1.01 (the parser trims). `parseBrokerEntryPremium` (`positionMetrics.ts:109`) accepts 0 and also `"1e2"` and `"0x10"` (via `Number()`). Pairing adds its own `<= 0` reject, and the held-cost reader must accept plain decimal strings only (`/^\d+(\.\d+)?$/` after trim; equivalent is fine), so exponent and hex forms fail closed (this also rejects `".5"`, `"5."` and `"+5"`, which is fail-closed and acceptable). The reader needs a separate number branch (finite and > 0), since `NaN` and `Infinity` are not strings. Do not change `parseBrokerEntryPremium` itself: other callers use it.

### Unit guard (Ian's revision)

Units are confirmed per share, so the guard only catches a gross x100 error, and its value is a clearer message, not safety: an unguarded x100 value would fail closed on the floor anyway. Ian rejected the draft rule `avgOpen > spot` because it blocks a legitimate loser (a LEAP bought at 20 on a stock that has since dropped to 60; note that at spot 60 a Kl 70 LEAP is OTM and never reaches the floor, so the loser fixtures use spot 72). **Rule: `avgOpen > 2 × max(spot, Kl)` → `COST_BASIS_UNAVAILABLE` with a unit-suspect detail.** It does **not** catch a /100 error (0.2085 would falsely pass) and no guard can; do not claim it does.

| # | Case | Kl | Spot | avgOpen | Ks / bid | Expected |
|---|---|---|---|---|---|---|
| A14 | x100 error | 70 | 85 | "2085" | 90 / 0.86 | 2085 > 2 × 85 → `COST_BASIS_UNAVAILABLE`, unit-suspect detail, not a plain floor miss |
| A20a | Legitimate loser passes the guard (30.00 > 2 × 72 is false) | 70 | 72 | "30.00" | 95 / 2.00 | guard passes; floor rejects: 9700 > 10000 cents is false → `SHORT_NOT_ABOVE_HELD_BREAKEVEN` (same as A21) |
| A20b | Cost near spot is not blocked | 70 | 85 | "84.99" | 90 / 0.86 | guard passes (84.99 > 170 is false); floor rejects: 9086 > 15499 cents is false → `SHORT_NOT_ABOVE_HELD_BREAKEVEN` |
| A20c | Guard boundary: strict `>` | 70 | 85 | "170.00" | 90 / 0.86 | guard passes (equal); floor rejects. `"170.01"` → `COST_BASIS_UNAVAILABLE`, unit-suspect |

### Multi-lot (decision 2): parse-boundary test only

Weighted average only when all lots share strike and expiry and each has a valid basis. **The multi-lot path cannot occur in the app today** (checked 2026-09-24): `exactOneLongCall` (`pmccHeldLeaps.ts`) accepts only a position with exactly one leg and not `structureAmbiguous`, a leg has one strike and one expiry, and the broker's `average-open-price` on that row is assumed to be the weighted average across lots. **This is an unverified assumption** (Dean, 2026-09-24): the only real payload seen is a single-lot NFLX position. **Before build, confirm it against a real `quantity > 1` payload** (one row for several contracts opened at different prices, and separate rows for one symbol if the broker ever returns them). Until confirmed, fail closed on anything not verified: If it cannot be confirmed, a held LEAP with `quantity > 1` fails closed as `COST_BASIS_UNAVAILABLE`. Raw rows are bucketed by underlying and expiry (`acquisition.ts:1281`) and go through `analyzePositionStructure`; anything that is not exactly one long call never reaches pairing. So A15 to A17 are a **unit test of a small pure helper at the parse boundary** (Dean, 2026-09-24), not a pairing-path test. They exist only if the build adds a helper that takes a list of lots; if the build reads the single leg's `avgOpenPrice` directly, there is nothing to test and decision 2 is satisfied by construction.

| # | Case | Kl | Lots | Ks / bid | Expected |
|---|---|---|---|---|---|
| A15 | Same strike and expiry | 70 | 2 @ "20.00", 1 @ "23.00" | 90 / 1.00 | weighted 21.00, floor 91.00; 91.00 > 91.00 false → reject. Bid 1.01 qualifies |
| A16 | One lot invalid | 70 | "20.00" and `null` | 90 / 5.00 | `COST_BASIS_UNAVAILABLE` |
| A17 | Mixed strike or expiry | 70 and 75 | valid on both | 100 / 5.00 | fail closed (`COST_BASIS_UNAVAILABLE`); never blend across LEAPs |

### New entry (unchanged)

| # | Case | Kl | Long ask | Ks | Short bid | Expected |
|---|---|---|---|---|---|---|
| A18 | F4a | 80 | 24.10 | 105 | 1.60 | debit 22.50 < width 25 → qualifies |
| A19 | Equality (strict) | 80 | 24.10 | 102.50 | 1.60 | 22.50 = 22.50 → `NET_DEBIT_NOT_BELOW_WIDTH` (near-miss as today). A junk `avgOpen` on a new-entry pair has no effect |

### Decision 4 as tests

`COST_BASIS_UNAVAILABLE` shows as a rejection reason, as a caption on the LEAP row, and as a banner line when it is why a held LEAP shows zero shorts. Copy is Diane's. When every short fails the floor (A21), the banner names the floor, kept factual ("floor is LEAP strike + cost basis"). No warning that overrides the disqualification ("trust the qualified realm").

### Ian's review (2026-09-24): approve with changes, changes applied

- Floor, strict equality, short **bid** (not mid), fail-closed and the two-code split confirmed.
- A loser LEAP can push the required strike above every candidate and leave zero shorts. That is the honest answer, not a bug.
- Prior roll credits are not netted into `avgOpenPrice`; that stays a larger, separate product question.

### Open items

1. **Fees:** `avgOpenPrice` is assumed to exclude fees, seen on one payload. A 0.01 to 0.05 difference could flip an equality case at the boundary. Known limit.
2. **Parser scope: closed (Dean, 2026-09-24).** `"1e2"` and `"0x10"` reject (fail closed); see A12.
3. **Multi-lot: assumption unverified; confirm before build.** The path cannot occur in the app per the code (above), so A15 to A17 are a parse-boundary unit test, but the broker-side averaging is unverified until a real `quantity > 1` payload is checked. Fail closed on anything not verified. Build is blocked until a real `quantity > 1` payload confirms the broker's `average-open-price` is the weighted average. If it cannot be confirmed, a held LEAP with `quantity > 1` fails closed as `COST_BASIS_UNAVAILABLE`.
4. **Where the tests live:** `HeldPmccLongCandidate` has no cost field yet; it should carry the already-parsed number, so string cases (A7 to A13) belong at the parse boundary and the floor cases at pairing.

## Validation

Engine tests on the fixtures above, the existing PMCC pairing tests, then a Vercel preview build.

## Rollout

The floor is engine-only. Before the PMCC registry migration (`SCREENER-CONFIG-0001B` follow-on).
