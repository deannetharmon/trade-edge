# WHEEL-SYSTEM-0001 — Wheel capital plan and unlock ladder (slice W1)

**Status:** W1 BUILT 2026-09-26 (approved by Dean the same day); see "Build notes" at the end. Earlier: DRAFT 3, ready for Dean's approval to build W1 (Alan, Quinn and Dane reviews folded in below; Ian and Paul inline earlier; the $40,000 / $5,000 split accepted by Dean). Not approved to build. Owner: Dean Harmon.
**Mock:** https://claude.ai/artifact/PqJWm8PT2WvR4SwZHwDmTH (screens 1 and 1b are approved by Dean; screens 2 to 4 are layout only).
**Roadmap:** item 14.

## Why

Dean wants one wheel-native system that (a) helps him decide what to wheel next and (b) manages capital efficiently. Reading the Wheel page, the wheel simulator and the Income Engine showed that at $50,000 almost nothing he likes fits a cash-secured-put wheel (one MU put needs about $100,000). W1 is the smallest useful slice: it turns the account size and a chosen risk profile into what fits today and when the rest unlock. It needs no new data source and no cycle history.

## Decisions already made by Dean (2026-09-26)

1. Account $50,000: **$5,000 cash reserve** the plan never uses, **$40,000 for the wheel** and **$5,000 as the total spread-risk cap** (accepted by Dean 2026-09-26; see the last section).
2. Profile: **Balanced** (recommended, screen 1 approved). Careful and Concentrated remain selectable.
3. Start with sector ETFs (XLU, XLF, XLE, XLP under Balanced; XLV only at Concentrated or about $53k). Larger names: small put spreads from the existing screener, counted inside the $45,000.
4. Sector ETFs move together in a selloff; the stress test is the honest number (Dean agrees).
5. Hurdle (used from W2, not W1): premium return must clear **10% a year**, measured at the actual bid, after fees. Below it the answer is "wait"; parked cash is counted at what it earns.
6. Spreads on names he likes get a **total risk cap** (Ian proposed 5% of the account, $2,500; Dean to confirm the number).
7. **Leveraged and inverse ETFs (TQQQ and similar) stay off the wheel list**; they may be traded only as small put spreads inside the spread-risk cap (Dean agreed 2026-09-26, after Ian's ruling; see O7).
8. The Income Engine's SPX bucket is retired; SPY, VOO, QQQ and DIA are not part of this plan.

## Scope (W1 only)

A "Plan" tab on the Wheel page (its sub-tab bar already exists) showing:

1. The profile chooser and the common limits (reserve, deployable cash, sector limit).
2. The stress test.
3. The unlock ladder for the symbols on the wheel list, using live quotes.
4. A per-name line: cash for one put, contracts that fit under the per-name limit, and total deployed against the $45,000.

Out of scope for W1: the wheel score and ranking (W2), cycles and true cost basis (W3), idle-capital and hurdle comparison (W4), any order placement, removal of the old Wheel candidates tab or the simulator.

## Arithmetic (pure functions in `lib/wheel/capitalPlan.ts`, integer cents)

- `A` = total account (dollars, user-entered, default 50,000). `reserve = 10% of A`. `wheelCash = A - reserve - spreadCap` (Balanced default: 50,000 - 5,000 - 5,000 = 40,000; both the reserve and the spread cap are editable in the plan).
- Profile loss budget `b` in {0.06, 0.09, 0.12} of `A`. Assumed drop `d = 0.30` (constant, stated on screen).
- `maxCashPerName = b × A / d` (Balanced: 0.09 × 50,000 / 0.30 = 15,000). Highest strike that fits = `floor(maxCashPerName / 100)`.
- `cashForOnePut = strike × 100`, where strike is the put at the target delta (0.20) in the live chain. The mock's ladder used "price × 0.93 rounded" as a placeholder; W1 must use the real chain strike, and show "no put found" when the chain has none.
- `contractsThatFit = floor(maxCashPerName / cashForOnePut)`.
- `fitsAtAccountSize = cashForOnePut × d / b` (Balanced: cash / 0.30).
- Sector limit: 35% of `A` per sector (needs a sector per symbol; see open item O2).
- Stress: every holding falls 25%: `0.25 × deployedCash`; report dollars and percent of `A`.
- Round money to cents with integer math; percentages to one decimal.

### Golden fixtures for Alan (Balanced, A = 50,000)

| Case | Cash for one put | Contracts that fit | Fits at account size |
|---|---|---|---|
| XLF, strike 51 | 5,100 | 2 (10,200) | 17,000 |
| XLE, strike 58 | 5,800 | 2 (11,600) | 19,333.33 |
| XLU, strike 37 | 3,700 | 4 (14,800) | 12,333.33 |
| XLP, strike 76 | 7,600 | 1 (7,600) | 25,333.33 |
| XLV, strike 159 | 15,900 | 0 (1 at Concentrated) | 53,000 |

Sample plan (wheel cash 40,000): XLF 2 + XLE 2 + XLU 2 + XLP 1 = 36,800 deployed (XLU is trimmed from 4 to 2 to stay inside 40,000). Stress at 25% = 9,200 = 18.4% of A. Worst case with spreads at full loss (cap 5,000): 9,200 + 5,000 = 14,200 = 28.4%; wheel fully deployed at 40,000: 10,000 + 5,000 = 15,000 = 30.0%. Boundary tests: cash exactly equal to `maxCashPerName` fits 1; one cent over fits 0. Concentrated and Careful rows are computed the same way.

## Data and files

- New: `lib/wheel/capitalPlan.ts` (pure), `lib/wheel/__tests__/capitalPlan.test.ts`, `app/api/wheel-plan/route.ts` (Redis `wheel-plan:${userId}`, session-checked like the existing wheel routes), a `WheelPlanTab` component under `features/wheel/`.
- Reuse: `getWheelQuote` and `fetchWheelChain` (`lib/wheel/chainSearch.ts`), the Wheel page tab bar (`app/wheel/page.tsx:399-406`), the existing watchlist. The page logic stays in `lib/` and the component; `page.tsx` only wires the tab.
- The wheel list is a tagged subset of the Opportunity Universe (tag stored with the plan; no second watchlist).
- Browser-side only for TastyTrade calls. No order paths touched.

## Open items

- **O1** DECIDED (Dean 2026-09-26, "a good middle ground"): total most-you-can-lose across all open spreads on liked names is capped at 10% of the account ($5,000), superseded from the earlier 5% ($2,500) by the accepted split below; Ian adds a single-spread cap of 2% ($1,000). Spread collateral counts inside the $45,000. Not enforced in W1 (display only: the plan shows the cap and the room left); enforcement belongs with the spread-entry flow.
- **O2** Sector for each symbol (ETFs are their own sector; single stocks need a mapping). W1 can ship with ETFs only and a manual sector field.
- **O3** Target delta 0.20 is Ian's proposal; Dean or Ian to confirm.
- **O4** Whether `A` follows live net liquidation value or stays a typed number. Recommend typed for W1, so the plan does not move with the market.
- **O5** Does "fits at" use account size (as mocked) or wheel capital? Mock and fixtures use account size.
- **O7** Per-symbol drop assumption (raised 2026-09-26 by Dean's TQQQ question). The 30% drop is fine for ordinary ETFs but wrong for leveraged ETFs: TQQQ (last close about $79.60, public feed, unverified) fell 81.8% peak to trough (Nov 2021 to Dec 2022) and 69% in one 21-day stretch (from Feb 2020); about 3.4% of its one-month windows lost 30% or more over ten years, against none for QQQ (worst 27.6%). Proposal: `maxCashPerName = b x A / d_i`, with `d_i` = 0.30 by default and a per-symbol override; leveraged and inverse ETFs default to their own worst-month history (about 0.70 for TQQQ, which limits a Balanced TQQQ put to about $6,430 of cash, a strike of $64) and are excluded from the wheel list by default (Ian: a wheel needs to hold assigned shares until they recover, and daily-reset leveraged ETFs can need +449% to recover from an 82% drop). Alan to confirm the history figures from a verified source.
- **O8** Months to unlock (Dean 2026-09-26: no new capital, only reinvested returns). Add an editable assumed monthly growth of the account (default 0.75% a month, stated as a simple monthly rate; stated as no losses, fees or taxes) and a "months to unlock" column: `months = ceil(ln(fitsAtAccountSize / A) / ln(1 + g))`, blank when the name already fits, "not reached" if `g <= 0`. Illustrative results at A = 50,000 with g = 0.75% and ceil: XLV (53,000) 8 months (7.80) and PLTR (58,700) 22 months (21.47). (Draft 1 said g = 0.72%, which gives 9 and 23; corrected.) Alan to fix rounding and fixtures. Note the Concentrated profile lowers every threshold by one quarter (cash / 0.40).
- **O6** Verify the Yahoo prices used in the mock against the broker; the app uses broker quotes.

## Acceptance criteria

1. Choosing a profile updates every figure on the tab; the reserve is never counted as deployable.
2. Every fixture above passes; boundary tests pass; percentages match the mock.
3. Symbols with no put at the target delta show "no put found", never a guess.
4. Plan and wheel-list tag persist in Redis and load on another device.
5. No order or position is changed by this tab; no scoring or recommendation code is touched.
6. Text plain-language, calm styling, standing line "Guidance from TradeEdge rules. You decide; no orders are placed automatically."

## Review gates

Ian: profile, drop assumption, delta, stress wording. Alan: arithmetic and fixtures. Quinn: persistence, quote failures, tests. Diane: confirm the tab against the approved mock. Dane: developer review last. Paul: scope (this ticket is W1 only; W2 to W4 are separate tickets).

## Known problems in the old wheel code (not fixed by W1)

- The simulator appears to value an unassigned put at its current strike (suspected phantom gain; unconfirmed), never uses cost basis, and drifts at trailing growth.
- The Wheel page has no below-basis call guard and no earnings, IV rank or liquidity filter.
- Wheel and simulator settings live in the browser only.

## Revision 2: review changes (Alan, Quinn, Dane; verdict for all three: approve with changes)

Alan recomputed every fixture in the ticket by script and they are correct (2/2/4/1/0 contracts; 17,000 / 19,333.33 / 12,333.33 / 25,333.33 / 53,000; sample plan 44,200; stress 11,050 = 22.1%; TQQQ cash limit 6,428.57, strike 64). Required changes, now part of the spec:

**Arithmetic (Alan)**
1. Integer math only. Store the profile as basis points (Careful 600, Balanced 900, Concentrated 1200) and the drop as 3000 bps. `maxCashCents = floor(bBps * A_cents / dBps)`. Never compute `0.09 * 50000 / 0.3` in floats. Strikes convert to cents by rounding to the nearest cent (a strike like 37.5 is 3,750 cents).
2. Rounding: `contracts` and `maxCash` use floor; `fitsAt = ceil(cashCents * dBps / bBps)` (19,333.33 shows as 19,333.34); percentages half-up to one decimal, but any comparison against a cap uses the unrounded integer values.
3. Allocation order: cash goes first to the highest wheel score, and until W2 exists in the order of the wheel list; each name gets `min(perNameCap, remaining deployable)`. Add a fixture where deployable is exhausted.
4. `fitsAt` ignores the reserve and the deployable override (it is about total account size). "Already fits" means `fitsAt <= A`; that case shows no months, not `ln(1) = 0`.
5. O8: ceil, `g` is a simple monthly rate default 0.75%; `g <= 0` shows "not reached"; months above 600 show "over 50 years"; A <= 0 is rejected.
6. Extra fixtures (Balanced, A = 50,000, maxCash 15,000 unless noted): cash 15,000.00 fits 1, cash 15,000.01 fits 0; Careful (maxCash 10,000): XLU 3,700 fits 2, XLV fits at 79,500; Concentrated (maxCash 20,000): XLV 15,900 fits 1; A = 80,000: maxCash 24,000, reserve 8,000 (10%), spread cap 8,000 (10%), wheelCash 64,000; `fitsAt = A` exactly; `g = 0`; `g = 1e-9`.

**Persistence and failure states (Quinn)**
7. Copy the pattern of `app/api/wheel-config/route.ts:8-93` (`wheel-plan:${userId}`, `getServerSession`, 401 on every method, same DELETE) but not its unvalidated body spread (`:68-72`) or its 500 on malformed stored JSON (`:46-49`). Schema: `{ overrides: Partial<Params>, wheelList: [{ symbol, sector?, dropOverride? }], updatedAt }` (see "Defaults and overrides" below: only overrides are stored, never a copy of the defaults). POST validates: `accountValue > 0`, profile is one of three, `monthlyGrowth` finite, symbols unique uppercase. A parse failure on read returns defaults. GET before any POST returns defaults (50,000, Balanced, 0.75%, empty list).
8. Per-row states, so a failure never looks like "no put": "quote unavailable" (`getWheelQuote` returned null, `chainSearch.ts:133-145`), "chain error" (`fetchWheelChain` threw, `:62`, or a greeks batch failed; batches are skipped silently at `:94-99`, so W1 must treat an empty result from a failed batch as "chain error", not "no put found"), and "no put found". One failed symbol never blanks the tab; each row has a retry.
9. Token: `getAccessToken` from `lib/auth/tastytradeToken` (as `app/wheel/page.tsx:23`); missing or expired shows "Reconnect TastyTrade". Never fall back to a stale strike.
10. Empty wheel list: profile chooser and limits still render, stress is $0, a plain "Add a symbol" line. Fetches run one symbol at a time (or a small fixed concurrency) and ignore a response that arrives after the profile or symbol changed.
11. Tests: `capitalPlan` (fixtures and boundaries), plan schema validation, route tests with mocked session and Redis (401, malformed JSON, GET-before-POST, DELETE), row-state selection (null quote, thrown chain, failed batch, no put), component tests for empty, loading, error and token-expired states, and a smoke test that the Candidates tab still renders unchanged. The tab bar at `app/wheel/page.tsx:399-406` is a static span with no state; add tab state there, keep the Candidates content and its fetch effects unchanged, and do not re-run them on tab switch.

**Build details (Dane)**
12. Strike rule (was unspecified): the put whose absolute delta is nearest 0.20 among expirations within 30 to 45 DTE (the wheel-config default window), preferring the nearest expiry on a tie of delta, then the lower strike. Legs with a null delta or bid = 0 and ask = 0 are skipped. Delta units are fractions (0.20); the wheel page divides the config's whole numbers by 100 (`app/wheel/page.tsx:184-187`). Reuse `findBestWheelContract` (`lib/wheel/chainSearch.ts:176-219`) with a delta target of {0.20, 0.20}. W1 applies no open-interest or bid-ask filter (W2 owns filters).
13. Sector: stored in the plan (`wheelList[].sector`), ETFs default to their own sector, a symbol with no sector counts as its own sector. The wheel list tag lives in the plan and W1 does not read `wheel-candidates`.
14. The per-symbol drop override (O7) lives in the plan schema in W1 (`dropOverride`, basis points). Leveraged and inverse ETFs added to the list show the warning "Not a wheel candidate" and are excluded from the plan totals.
15. Files: `features/wheel/WheelPlanTab.tsx`, `features/wheel/__tests__/`, `lib/wheel/capitalPlan.ts`, `lib/wheel/__tests__/capitalPlan.test.ts`, `app/api/wheel-plan/route.ts` (vitest already includes `lib/**/__tests__` and the features layout).

## Accepted by Dean (2026-09-26)

Dean proposed a $5,000 spread-risk cap and $40,000 for the wheel (instead of $2,500 and $42,500), leaving the $5,000 reserve. Ian supports it with conditions: single-spread cap stays 2% ($1,000); the screen shows the honest worst case (wheel at a 25% fall plus spreads at full loss, about $15,000 or 30% of the account); review the cap after about ten spreads under the new rules, falling back to $2,500 if panic-closing returns. Dean accepted it. Applied above: O1 cap is now $5,000 total and $1,000 per spread (2%), wheelCash is $40,000, the sample plan and stress fixtures are recomputed. Alan to re-verify the recomputed fixtures.

## Defaults and overrides (Dean, 2026-09-26): every parameter has a default and can be changed at any time

Principle: the app ships with sensible defaults, and Dean can change any parameter whenever he wants. The app may warn; it never blocks a value that is mathematically valid ("trust the qualified realm", "you decide").

**Editable parameters in W1, with defaults**

| Parameter | Default | Notes |
|---|---|---|
| Account value A | $50,000 | typed number (O4) |
| Reserve | 10% of A ($5,000) | dollars or percent |
| Spread-risk cap, total | 10% of A ($5,000) | |
| Spread cap, single spread | 2% of A ($1,000) | |
| Profile | Balanced (900 bps) | Careful 600, Concentrated 1200, or Custom (any loss budget in bps) |
| Assumed drop d | 30% (3000 bps) | applies to every name unless overridden |
| Per-symbol drop override | none | leveraged ETFs default to their own history (O7) |
| Stress fall | 25% | the stress test line |
| Sector limit | 35% of A | |
| Target delta | 0.20 | strike rule |
| DTE window | 30 to 45 | strike rule |
| Assumed monthly growth g | 0.75% | months-to-unlock |
| Later slices (recorded now) | premium hurdle 10% a year; IV rank floor about 20 | W2 |

**Behavior**
1. Each field shows its current value, a "default" tag when unchanged, and a "changed from default (was X)" note plus a one-tap "Reset" when changed. A "Reset all to defaults" action is available.
2. Storage: the plan stores **only the overrides** (`overrides: Partial<Params>`), never a copy of the defaults. The effective value is `{ ...DEFAULTS, ...overrides }`, defaults live in `lib/wheel/capitalPlan.ts`, and resetting a field deletes its key. A later change to a default therefore never overwrites something Dean set, and never leaves a stale copy behind.
3. Validation is split in two. **Hard errors** (refuse to save) only for values that break the math: non-finite, A <= 0, percentages below 0 or above 100, reserve plus spread cap above 100%, delta outside (0, 1), DTE min above max. **Soft warnings** (save anyway, amber line) for values outside Ian's recommended ranges, for example a per-name loss budget above 12%, a drop assumption under 20%, a reserve under 5%, a total spread cap above 10%, a delta above 0.35. The warning says plainly what the value does to the worst-case figure.
4. Every figure on the tab recalculates from the effective values, and the worst-case line always shows the current numbers, so an override that raises risk is visible immediately.
5. Nothing here changes an order or a recommendation, and defaults are Ian's recommendations, not rules.

**Added acceptance criteria and tests**
- Changing any parameter updates the tab; resetting returns it to the default; a stored plan with only overrides loads correctly and an empty plan loads all defaults.
- Changing a default constant in code changes the effective value for every field that is not overridden (test with a stubbed default).
- Hard-error and soft-warning cases each have a test; a soft warning never blocks saving.
- Route tests accept a partial overrides object and reject unknown keys and invalid types.

## Build notes (W1, 2026-09-26)

Built as specified in draft 3 plus Revision 2 and the defaults-and-overrides section. Files: `lib/wheel/capitalPlan.ts`, `lib/wheel/planSchema.ts`, `lib/wheel/planPut.ts`, `app/api/wheel-plan/route.ts`, `features/wheel/WheelPlanTab.tsx`, a Plan tab in `app/wheel/page.tsx` (Candidates stays mounted, hidden), and `failedBatches` added (optional, backward compatible) to `WheelChainResult` in `lib/wheel/chainSearch.ts`. Tests: 114 new or touched (capitalPlan 53, planSchema 22, planPut 14, route 10, Plan tab 13, Wheel page tabs 2). Verification run: `tsc --noEmit -p tsconfig.check.json` clean; a real `next build` exit 0 with `/api/wheel-plan` listed; full suite 397 files / 5,769 tests passing.

Implementation decisions the spec left open (Ian or Alan may overrule):
1. A put more than 0.10 delta from the target is not used ("no put found"); the target itself and its default are editable.
2. Row state precedence: chain error, then failed quote batch with no put (chain error), then missing quote with no put (quote unavailable), then no put found. A missing quote with a put found still prices the row and shows "unavailable" for the price.
3. The tab offers an "Add starter ETFs" button (XLU, XLF, XLE, XLP, XLV) when the list is empty; the saved default list stays empty.
4. Reserve and caps are edited as percentages (the dollar amounts show in the limits panel), not as dollars.
5. Not done in W1 by design: ranking and the hurdle (W2), cycles (W3), idle-capital view (W4), spread-cap enforcement, removal of the old Candidates tab or the simulator. Alan's formal re-check of the recomputed fixtures is still owed (the fixtures are encoded in the tests and pass).
