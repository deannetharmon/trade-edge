# PMCC-HELD-BREAKEVEN-0001 — Held-LEAP short calls have no breakeven floor

## Status

**Logged; approved by Dean 2026-09-24. Not built.** Bug, **P1** (Ian). Paul rated it P0; both agree it goes first. Found during the `SCAN-ALIGN-0001` review (slice A). Units confirmed 2026-09-24 (decision 1). Decision 4 closed by Dean 2026-09-24. **Permanent rule (Dean, 2026-09-24):** see "Quantity guard (permanent)" below; multi-lot broker averaging is unverifiable and does not block build. Fixtures drafted by Alan and reviewed by Ian 2026-09-24 (below); Ian signs off on the floor logic and codes with the loosened unit guard. **Revised 2026-09-24 after Paul (scope), Alan (A23 to A34 fixtures), Ian (A23/A24 text) and Quinn (build plan) reviews; Ian and Alan re-confirmed the latest revision 2026-09-24 (Ian with the near-miss display condition, open item 5); Quinn confirmed her six corrections and her final three text fixes are applied.** Scope approved by Paul with conditions: the caption and banner ship in `PMCC-HELD-BREAKEVEN-0001B` (PR1 merge holds if its mock is not approved within 1 to 2 working sessions); one wiring test per held entry point; no third reason code.

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
2. Multi-lot held LEAPs: **decided, superseded by the permanent rule (Dean, 2026-09-24).** A held LEAP with `quantity > 1` fails closed. No weighted average is applied, because broker-side averaging across lots is untested against a real multi-lot payload (see "Quantity guard (permanent)").
3. Fail closed when `avgOpenPrice` is null, non-finite or <= 0 (a zero basis from assignment or transfer would pass trivially). **Decided.**
4. Where the "cost basis unavailable" reason shows (rejected reason code vs. near-miss), and its copy. **Closed (Dean, 2026-09-24), accepted as recommended; routing refined 2026-09-24 in `PMCC-HELD-BREAKEVEN-0001B` (a fixable read failure blocks before the modal; multi-lot and floor-not-met open the modal with an in-modal banner and caption; per-LEAP results).** Diane's proposal: rejection reason plus a caption on the LEAP row, and a banner line when it is why a held LEAP shows zero shorts.

## Acceptance criteria

- A held-LEAP pair where `Ks + shortBid <= Kl + avgOpenPrice` does not qualify and carries a named reason code.
- A held-LEAP pair with `avgOpenPrice` null or non-finite does not qualify and shows "cost basis unavailable."
- New-entry pairing results do not change.

## Golden fixtures (Alan, drafted 2026-09-24; Ian's changes applied)

All prices are per share. The floor compares in **integer cents** (`Math.round(x * 100)`), strict `>`. `avgOpenPrice` arrives from the broker as a **string**; fixtures use strings unless noted. The held result never depends on the live long ask.

**Spot:** every held row needs a spot with `Kl < spot < Ks` (`LONG_NOT_ITM` and `SHORT_NOT_OTM` still apply to held pairs, `pmccPairing.ts:167-168`, and an OTM long drops out before the floor is evaluated). Unless a row says otherwise use spot = midpoint of Kl and Ks (A1 to A3 and A6 to A13: 92.5; A4, A5, A15, A16: 80; A17: spot is irrelevant, the mixed-strike check fails first). **Check order, pinned (Alan, 2026-09-24; Ian confirmed): data validity (basis missing, zero, negative, non-finite, unparseable), then quantity guard, then unit guard, then floor.** A short that would clear the floor never rescues a `quantity > 1` row, and a qty-2 row with a x100 basis reports the multi-lot detail, not unit-suspect.

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
| A12 | Unparseable string (Dean, 2026-09-24: reject, including exponent and hex forms). **`"1e2"` and `"0x10"` are reader-unit only:** the reader rejects the string; a pairing test fed the resulting number (client path: 100 and 16) is **not** asserted, because the number branch accepts them (with 16: 108 > 96 qualifies) | `"abc"`, `""`, `" "`, `"26.00x"`, `"1e2"`, `"0x10"` | 80 / 105 / 3.00 |

A11 and A12 may be one table-driven test (Quinn's call). A13: `" 26.00 "` parses to 26.00 and qualifies at bid 1.01 (the parser trims). `parseBrokerEntryPremium` (`positionMetrics.ts:109`) accepts 0 and also `"1e2"` and `"0x10"` (via `Number()`). Pairing adds its own `<= 0` reject, and the held-cost reader must accept plain decimal strings only (`/^\d+(\.\d+)?$/` after trim; equivalent is fine), so exponent and hex forms fail closed (this also rejects `".5"`, `"5."` and `"+5"`, which is fail-closed and acceptable). The reader needs a separate number branch (finite and > 0), since `NaN` and `Infinity` are not strings. Do not change `parseBrokerEntryPremium` itself: other callers use it.

### Unit guard (Ian's revision)

Units are confirmed per share, so the guard only catches a gross x100 error, and its value is a clearer message, not safety: an unguarded x100 value would fail closed on the floor anyway. Ian rejected the draft rule `avgOpen > spot` because it blocks a legitimate loser (a LEAP bought at 20 on a stock that has since dropped to 60; note that at spot 60 a Kl 70 LEAP is OTM and never reaches the floor, so the loser fixtures use spot 72). **Rule: `avgOpen > 2 × max(spot, Kl)` → `COST_BASIS_UNAVAILABLE` with a unit-suspect detail. If `spot` is not finite, the bound is `2 × Kl`, implemented as `Number.isFinite(spot) ? Math.max(spot, Kl) : Kl` (`Math.max(NaN, Kl)` is NaN and `x > NaN` is false, which would silently disable the guard).** It does **not** catch a /100 error (0.2085 would falsely pass) and no guard can; do not claim it does.

| # | Case | Kl | Spot | avgOpen | Ks / bid | Expected |
|---|---|---|---|---|---|---|
| A14 | x100 error | 70 | 85 | "2085" | 90 / 0.86 | 2085 > 2 × 85 → `COST_BASIS_UNAVAILABLE`, unit-suspect detail, not a plain floor miss |
| A20a | Legitimate loser passes the guard (30.00 > 2 × 72 is false) | 70 | 72 | "30.00" | 95 / 2.00 | guard passes; floor rejects: 9700 > 10000 cents is false → `SHORT_NOT_ABOVE_HELD_BREAKEVEN` (same as A21) |
| A20b | Cost near spot is not blocked | 70 | 85 | "84.99" | 90 / 0.86 | guard passes (84.99 > 170 is false); floor rejects: 9086 > 15499 cents is false → `SHORT_NOT_ABOVE_HELD_BREAKEVEN` |
| A20c | Guard boundary: strict `>` | 70 | 85 | "170.00" | 90 / 0.86 | guard passes (equal); floor rejects. `"170.01"` → `COST_BASIS_UNAVAILABLE`, unit-suspect |

### Multi-lot weighted average (dormant)

A15 to A17 below described a weighted-average path. **The permanent quantity rule forbids that path, so A15 and A16 are dormant: do not build a weighted-average helper just to test them.** A17 (mixed strike or expiry) still fails closed and is consistent with the rule. The path cannot occur in the app today in any case: `exactOneLongCall` (`pmccHeldLeaps.ts`) accepts only a position with exactly one leg and not `structureAmbiguous`, and a leg has one strike and one expiry. Kept for reference if the rule is ever relaxed.

| # | Case | Kl | Lots | Ks / bid | Expected (dormant) |
|---|---|---|---|---|---|
| A15 | Same strike and expiry | 70 | 2 @ "20.00", 1 @ "23.00" | 90 / 1.00 | would be weighted 21.00, floor 91.00; reject at 1.00, qualify at 1.01. Not built |
| A16 | One lot invalid | 70 | "20.00" and `null` | 90 / 5.00 | would be `COST_BASIS_UNAVAILABLE`. Not built |
| A17 | Mixed strike or expiry | 70 and 75 | valid on both | 100 / 5.00 | fail closed (`COST_BASIS_UNAVAILABLE`); never blend across LEAPs |

### Quantity guard (permanent)

**Permanent rule (Dean, 2026-09-24): a held LEAP with `quantity` other than exactly 1 fails closed as `COST_BASIS_UNAVAILABLE`.** The broker-side averaging across lots is **untested against a real multi-lot payload**: Dean holds only single-contract LEAPs (UBER, NFLX), so it is **unverifiable for now and does not block build**. Revisit if Dean ever holds a multi-lot LEAP; only then can the rule be relaxed. Consequence, intentional: every held LEAP of 2 or more contracts, including 2 filled at one price, gets no held-mode shorts.

**Guard form (Alan, 2026-09-24):** written on the positive side, `Number.isInteger(q) && q === 1`; anything else fails closed. A naive `q > 1` would pass NaN (`NaN > 1` is false). **Detail strings** (asserted exactly in tests; the UI may key off them; no third reason code; **final copy is Ian's and Diane's, the strings below are pinned for the build until they change them**): basis missing or unusable `"cost basis unavailable"`; unit-suspect `"cost basis unit suspect"`; integer > 1 uses `"multi-lot LEAP: cost averaging unverified"`; missing, non-finite, non-integer, zero or negative uses `"held quantity invalid"`. The server path must parse quantity strictly with `Number()`, not `parseInt` (`parseInt("1.5")` is 1, `parseInt("abc")` is NaN), and must use the broker-fetched held quantity, never the client-supplied `input.quantity` (that is the sell quantity).

Baseline for the rows below: a valid basis and a short that clears the floor (the A2 values: Kl 80, avgOpen "26.00", Ks 105, bid 1.01, spot 92.5), or one that misses it (the A3 values, bid 0.99), unless noted. **A22 is unused** (numbering skips it; nothing is missing).

| # | quantity | avgOpen | Other | Expected |
|---|---|---|---|---|
| A23 | 2 | valid | short clears floor | `COST_BASIS_UNAVAILABLE`, "multi-lot LEAP: cost averaging unverified", not qualified |
| A23b | 100 | valid | short clears floor | same as A23 |
| A24 | 1 | valid | short clears floor | qualifies via the floor (as A2); no quantity detail |
| A24b | 1 | valid | short misses floor (A3 values) | `SHORT_NOT_ABOVE_HELD_BREAKEVEN` |
| A25a | `"1"` (string) at the candidate boundary | valid | | **Pinned (Ian confirmed): fail closed, "held quantity invalid".** `HeldPmccLongCandidate.quantity` is a number; a string is out of contract. Helper-level: the helper's quantity parameter is typed `unknown` |
| A25b | `"2"` (broker string, server path) | valid | | `Number("2")` = 2, multi-lot detail |
| A25c | `"1.0"` (broker string, server path) | valid | | `Number("1.0")` = 1, integer, passes the guard |
| A26 | 0 | valid | | `COST_BASIS_UNAVAILABLE`, "held quantity invalid" |
| A27 | -1 | valid | | same as A26 |
| A28 | 1.5 | valid | | same as A26 (never treated as 1; never truncated by `parseInt`) |
| A28b | 2.5 | valid | | "held quantity invalid" |
| A29 | `NaN`, `undefined`, `null`, `"abc"` | valid | | "held quantity invalid"; must not pass |
| A30 | 2 | `"2085"` (x100) | | multi-lot detail, not unit-suspect (quantity precedes the unit guard) |
| A31 | 1 | `"2085"` (x100) | | unit-suspect detail (confirms A14) |
| A32 | 2 | `null`, `"0"`, `""` | | basis-missing detail (data validity precedes quantity; the two details never swap) |
| A33 | 2 | valid | short misses floor too | still `COST_BASIS_UNAVAILABLE`, not `SHORT_NOT_ABOVE_HELD_BREAKEVEN` |
| A34 | held qty 1, sell qty 1 | valid | server path | passes the guard (sell quantity is unrelated) |
| A35 | 1 | valid | **helper-level only** (pairing rejects a NaN spot upstream via `LONG_NOT_ITM`/`SHORT_NOT_OTM`): Kl 70, spot `NaN`, Ks 90, bid 0.86 | avgOpen `"20.85"` passes the guard (bound = 140); `"140.00"` passes the guard (equal; the floor then rejects, 9086 > 21000 cents is false); `"140.01"` and x100 `"2085"` → `COST_BASIS_UNAVAILABLE`, "cost basis unit suspect" (proves the guard still fires with a NaN spot); the floor does not use spot |
| A36 | 0 | `null` | basis invalid and quantity invalid together | "cost basis unavailable" (data validity precedes quantity) |

**Wiring tests (Paul's condition, Alan's design), required, one per held entry point,** each with a `quantity` 2 held fixture that is otherwise valid and whose short clears the floor, asserting no qualified pair and `COST_BASIS_UNAVAILABLE` with the multi-lot detail:

- **W1 production scan:** `runPmccProduction` (`pmccProduction.ts:257`) with a held candidate.
- **W2 server held trade review:** `serverTradeReview.ts:320`, the only held pairing call there. Mock `brokerGet` with `quantity: "2"`, `average-open-price: "20.85"`, `quantity-direction: 'Long'`, sell quantity 1; assert not ready and that no order body is built. Second case with `quantity: "1.5"` proves strict parsing (expected detail "held quantity invalid", as A28). Third case with `quantity: "1"` and a floor-failed held pair: not ready, no order body (a `COST_BASIS_UNAVAILABLE` or `SHORT_NOT_ABOVE_HELD_BREAKEVEN` pair must never make the review ready, even though it still reaches `qualified[0] ?? nearMiss[0]` at `serverTradeReview.ts:333`). Optional fourth case: `average-open-price: "1e2"` from the raw string, expecting not ready (the server path has raw strings). Highest order-path risk (submit path).
- **W3 readiness client:** `pmccHeldReadinessClient.ts:42` (goes through `runPmccSymbolProduction`) with held quantity 2 and a mocked chain; assert the status is not `review-income-call` and that the reason surfaces the multi-lot detail, not "No qualifying short-call candidate". If the mapping cannot surface it, log a copy gap for Ian and Diane.
- **Mutation check:** removing the guard from the shared helper makes W1 to W3 fail.

A23 to A36 were confirmed by Alan and Ian (2026-09-24); Quinn's last three text corrections are applied.

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
2. **Parser scope: closed (Dean, 2026-09-24), with a limit found by Quinn.** `"1e2"` and `"0x10"` reject (fail closed); see A12. On the **client path** the strings are already numbers by the time `HeldPmccLongCandidate` is built (`parseBrokerEntryPremium` uses `Number()`, `acquisition.ts:1317`, `:1838`), so the plain-decimal reader can only be applied on the **server path**, where raw strings are available and the reader replaces `finite()` for this field (so `""` and `null` are rejected by the reader directly, before any `<= 0` check); the client path gets a number branch. This divergence is documented, and A12's exponent and hex rows are testable at the reader unit level and in the optional W2 `"1e2"` case, not end to end on the client. The real payload is always plain decimal.
3. **Multi-lot: closed as unverifiable (Dean, 2026-09-24); not a build blocker.** See "Quantity guard (permanent)".
4. **Where the tests live (pinned, Alan 2026-09-24):** three separate pure pieces in `lib/scans`. (a) The plain-decimal **basis reader** (`string | number | null` in, `number | null` out) is applied on the server path and has a number branch on the client path; string rows A7 to A13 test it. (b) The **quantity parser** for the server path is its own strict function using `Number()`, never `parseInt` (`unknown` in, `number | null` out); A25b and A25c test it. (c) The **floor helper** takes the basis as `number | null` and quantity as `unknown`, so A25a and A29 (string, null, undefined, `"abc"`) are helper-level; floor, quantity, unit-guard and ordering rows test the helper. `HeldPmccLongCandidate` has no cost field yet; it should carry the already-parsed number.
5. **Near-miss display: answered (Ian, 2026-09-24), carried into `PMCC-HELD-BREAKEVEN-0001B`.** Floor-failed held pairs still appear in `nearMissPairs` as data. Alan: they must never make the review ready or build an order body, including at `serverTradeReview.ts:333`. Ian's condition: floor-failed, unit-suspect and multi-lot pairs must show in the held UI as **rejected with the reason code**, not styled or ranked as near-misses, and with no order or promote affordance (Diane and Quinn, in 0001B).

## Build notes (Quinn, 2026-09-24)

**Plan corrections**

1. **Held pairing entry points:** three, `pmccProduction.ts:257` (via `runPmccProduction`), `serverTradeReview.ts:320` (the only held pairing call there; `:146` is the new-entry path and must stay untouched; `:338` is `evaluatePmccDecision`, not pairing) and `pmccHeldReadinessClient.ts:42` (goes through `runPmccSymbolProduction`, so it inherits production wiring). Use one exported `heldLongKey(occSymbol)` at all three sites; a mismatched hand-built `occ:` key silently turns held mode off.
2. **Cost never reaches pairing today.** `pairPmccCandidates` takes only `heldLongOccSymbols`. Add a new input, e.g. `heldLongBasis: ReadonlyMap<occKey, { avgOpen, quantity }>`. The server has no `HeldPmccLongCandidate`; wire from `heldPosition` (`findHeldPmccLongPosition`, `serverTradeReview.ts:216-231`).
3. **Parser divergence** (open item 2).
4. **Session persistence (highest deploy risk).** `scanSession.ts:780-786` has a hard-coded `PMCC_FAILURE_CODES` allowlist used by `isValidPmccReason` (`:927-931`). A held result carrying either new code fails `INVALID_PMCC_RESULT` on validation or restore. Add both codes, and an exhaustiveness guard (`satisfies Record<PmccFailureCode, true>` or a shared const array). Do not remove the entries on a revert of the floor, or stored sessions fail validation.
5. **Near-miss claim narrowed.** `pmccPairing.ts:311-312` pushes every non-qualified pair into `allNearMisses`. "Not a near-miss" holds only for the `structurallyValid` counter (`:248`). Floor-failed held pairs still appear in `nearMissPairs` (and feed `serverTradeReview.ts:333`, `qualified[0] ?? nearMiss[0]`). Tests assert both facts; whether that is intended is a decision for Alan and Ian.

**Existing tests that flip or need fixture updates** (a held pair with no basis now fails closed)

- `pmccPairing.test.ts`: `:107`, `:117`, `:128` need basis (confirm the `[1090, 1080]` ordering in `:128`). `:163` passes a key without the `occ:` prefix, so it is silently testing the new-entry path (latent false positive): fix the key and add basis.
- `pmccProduction.test.ts`: `:165` has `quantity: 2` and no cost (flips on both guards; also the `:178` assertion on `heldLongLeg.quantity: 2`); `:184` needs cost; `:219` needs cost, plus a variant running a floor-failed held result through `validateSessionData` (proof for risk 4). `:204` unaffected. Make the new `HeldPmccLongCandidate` field **required** (`avgOpenPrice: number | null`) so tsc lists every construction site (`:166`, `:185`, `:205`, `:220`).
- `pmccHeldLeaps.test.ts`: add `toMatchObject` for the carried `avgOpenPrice` and `quantity`. The quantity guard lives in pairing or a shared helper, **not the selector** (a selector that dropped qty > 1 would make held LEAPs vanish instead of showing `COST_BASIS_UNAVAILABLE`).
- `ScreenerPage.test.tsx`: `heldEligibleLongCall` (`:96-100`, qty 1, avgOpen 20, Kl 150) tests at `:663/717/742/762` still qualify only if the mock short clears `Ks + bid > 170` (mock short at 205, bid not verified).
- Unaffected or verify: `pmccDecision.test.ts` (check the decision code does not pattern-match on failure codes), `pmccAuditSummary.test.ts` (add messages plus one test for the two codes), `pmccPairOnDemand.test.ts` (new-entry style, unchanged; sibling gap: the page pair lookup at `page.tsx:5685` for a held long does not apply the floor, logged separately), `pmccPairing.perf.test.ts` (keep the floor inside `if (isHeldLong)`, no per-pair work on the new-entry hot path; run it explicitly), `entryCaptureWiring.test.ts`, `PmccResultCardFields.test.tsx`.

**Design:** one exported pure helper in `lib/scans` (e.g. `evaluateHeldBreakevenFloor({ strikeLong, strikeShort, shortBid, spot, basis, quantity })` returning null or `{ code, message }`); A1 to A36 are tested table-driven: string rows (A7 to A13) at the reader, A25b and A25c at the quantity parser, the rest against the helper once and against `pairPmccCandidates` once. Compare in cents rounding both sides. A NaN spot (server: `longReview.spot ?? shortReview.spot ?? NaN`) needs a defined outcome, not `false > NaN` silently passing; add a NaN-spot test. Add a new-entry regression test: junk basis and quantity in the input give byte-identical output (A18, A19).

**Two commits (revertable):**

- **Commit 1, plumbing, no behavior change:** the two codes in `pmccTypes.ts`, the `scanSession.ts` allowlist plus exhaustiveness test, `pmccAuditSummary.ts` messages, the required field on `HeldPmccLongCandidate` with fixtures updated, and the pairing input accepted but not enforced. Tests prove the codes round-trip through `validateSessionData` and nothing flips.
- **Commit 2, the floor:** reader, quantity parser, cents comparison, quantity guard, unit guard and the three-entry-point wiring. **All behavior-changing test updates land here** (the basis-adding fixtures in `pmccPairing.test.ts` `:107/:117/:128/:163` and `pmccProduction.test.ts` `:165/:184/:219`, and the `ScreenerPage.test.tsx` held tests at `:663/717/742/762` if the mock short does not clear `Ks + bid > 170`), plus W1 to W3, the mutation check and the new-entry byte-identical regression, so commit 1 stays "nothing flips".

**Verification order:** targeted `npx vitest run` on the pairing, held-leaps, production, pair-on-demand, decision, audit-summary and perf tests plus the new helper, readiness-client and server wiring tests; then `ScreenerPage` and `PmccResultCardFields` plus any scanSession tests; then `npx tsc --noEmit -p tsconfig.check.json`; then the full suite (ask Dean first); then a branch push and Vercel preview `next build`, which is authoritative. The helper lives in `lib/`, no new named exports in `page.tsx`.

**Honest gaps:** the server wiring test is the heaviest new test and has no existing scaffold (if too heavy for PR1, at minimum a spy test on `pairPmccCandidates` args, stated plainly as not full coverage); the ScreenerPage mock-chain bids are unchecked.

**Release note:** if TastyTrade omits `average-open-price` for transferred or assigned lots, the trader now sees a rejection where they previously saw a candidate. Intended. Also: **2 or more contracts, even filled at one price, get no held-mode shorts** (permanent quantity rule).

## Validation

Engine tests on the fixtures above, the existing PMCC pairing tests, then a Vercel preview build.

## Rollout

The floor is engine-only. Before the PMCC registry migration (`SCREENER-CONFIG-0001B` follow-on).
