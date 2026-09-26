# WHEEL-SYSTEM-0001 — Wheel capital plan and unlock ladder (slice W1)

**Status:** DRAFT 1, 2026-09-26. Not approved to build. Owner: Dean Harmon.
**Mock:** https://claude.ai/artifact/PqJWm8PT2WvR4SwZHwDmTH (screens 1 and 1b are approved by Dean; screens 2 to 4 are layout only).
**Roadmap:** item 14.

## Why

Dean wants one wheel-native system that (a) helps him decide what to wheel next and (b) manages capital efficiently. Reading the Wheel page, the wheel simulator and the Income Engine showed that at $50,000 almost nothing he likes fits a cash-secured-put wheel (one MU put needs about $100,000). W1 is the smallest useful slice: it turns the account size and a chosen risk profile into what fits today and when the rest unlock. It needs no new data source and no cycle history.

## Decisions already made by Dean (2026-09-26)

1. Account $50,000: **$45,000 to the wheel, $5,000 cash reserve** the plan never uses.
2. Profile: **Balanced** (recommended, screen 1 approved). Careful and Concentrated remain selectable.
3. Start with sector ETFs (XLU, XLF, XLE, XLP under Balanced; XLV only at Concentrated or about $53k). Larger names: small put spreads from the existing screener, counted inside the $45,000.
4. Sector ETFs move together in a selloff; the stress test is the honest number (Dean agrees).
5. Hurdle (used from W2, not W1): premium return must clear **10% a year**, measured at the actual bid, after fees. Below it the answer is "wait"; parked cash is counted at what it earns.
6. Spreads on names he likes get a **total risk cap** (Ian proposed 5% of the account, $2,500; Dean to confirm the number).

## Scope (W1 only)

A "Plan" tab on the Wheel page (its sub-tab bar already exists) showing:

1. The profile chooser and the common limits (reserve, deployable cash, sector limit).
2. The stress test.
3. The unlock ladder for the symbols on the wheel list, using live quotes.
4. A per-name line: cash for one put, contracts that fit under the per-name limit, and total deployed against the $45,000.

Out of scope for W1: the wheel score and ranking (W2), cycles and true cost basis (W3), idle-capital and hurdle comparison (W4), any order placement, removal of the old Wheel candidates tab or the simulator.

## Arithmetic (pure functions in `lib/wheel/capitalPlan.ts`, integer cents)

- `A` = total account (dollars, user-entered, default 50,000). `reserve = 10% of A`. `deployable = A - reserve` (Dean may override to a chosen amount).
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

Sample plan XLF 2 + XLE 2 + XLU 4 + XLP 1 = 44,200 deployed (within 45,000). Stress at 25% = 11,050 = 22.1% of A. Boundary tests: cash exactly equal to `maxCashPerName` fits 1; one cent over fits 0. Concentrated and Careful rows are computed the same way.

## Data and files

- New: `lib/wheel/capitalPlan.ts` (pure), `lib/wheel/__tests__/capitalPlan.test.ts`, `app/api/wheel-plan/route.ts` (Redis `wheel-plan:${userId}`, session-checked like the existing wheel routes), a `WheelPlanTab` component under `features/wheel/`.
- Reuse: `getWheelQuote` and `fetchWheelChain` (`lib/wheel/chainSearch.ts`), the Wheel page tab bar (`app/wheel/page.tsx:399-406`), the existing watchlist. The page logic stays in `lib/` and the component; `page.tsx` only wires the tab.
- The wheel list is a tagged subset of the Opportunity Universe (tag stored with the plan; no second watchlist).
- Browser-side only for TastyTrade calls. No order paths touched.

## Open items

- **O1** Spread risk cap: 5% of the account ($2,500)? Dean to confirm.
- **O2** Sector for each symbol (ETFs are their own sector; single stocks need a mapping). W1 can ship with ETFs only and a manual sector field.
- **O3** Target delta 0.20 is Ian's proposal; Dean or Ian to confirm.
- **O4** Whether `A` follows live net liquidation value or stays a typed number. Recommend typed for W1, so the plan does not move with the market.
- **O5** Does "fits at" use account size (as mocked) or wheel capital? Mock and fixtures use account size.
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
