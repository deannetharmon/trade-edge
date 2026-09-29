# IVR-0002 — Separate Min IVR floors for stocks and for ETFs/indexes in the targeted scan

**Status:** DRAFT 2026-09-29. Ian: APPROVED WITH CHANGES 2026-09-29 (see "Ian's review"); awaiting Dean's confirmation, then Paul (scope) and Diane (mock) before build. Owner: Dean Harmon.
**Related:** IVR-0001 (made Min IVR an explicit field), CSP-IVR-0001, WHEEL-SYSTEM-0002 (the wheel already uses different IVR floors for ETFs and stocks).

## Why

The targeted scan has one **Min IVR %** floor, and it applies to every selected ticker (`app/screener/page.tsx`, `runTargetedScan`: the pre-filter at ~line 7688 and the per-symbol gate at ~7743). ETF and index IV runs in a narrower range, so at a floor that suits stocks (30%) most ETFs and indexes get dropped. The workaround today is two separate scans; the note under the field (added 2026-09-29) says so.

Dean wants one scan with the right floor for each type of underlying.

## Proposal

1. The Min IVR % field becomes two fields in the scan setup:
   - **Stocks:** default **30%**
   - **ETFs and indexes:** default **15%**, matching `DEFAULT_ETF_RULES.IVR_MIN` and `INDEX_IVR_MIN` in `lib/scans/constants.ts`
   Each keeps the chip row (Any, 10, 15, 20, 30, 40, 50) and a free-entry box. The guide note stays, shortened.
2. The gate picks the floor from the ticker's existing classification (`WatchlistTicker.classification`: `index` / `etf` / `stock`, already on every watchlist ticker and used for the Index/ETF/Stock grouping). `pending` or `unsupported` use the **stock** floor (the stricter one). This is Ian's call.
3. Presets (Strict / Course / Relaxed / Low Vol / Short Term / Intermediate) that set the IVR floor set both values. Current preset values carry over to the stock floor; each preset needs an ETF/index value (see the decisions below).
4. Saved scan settings: an older saved value with only one `ivrMin` loads as stock = that value and ETF/index = min(that value, 15), so an old 0/"Any" stays Any for both.
5. Results rows that failed the IVR gate say which floor applied ("IVR 12% below the ETF/index floor of 15%").

## Out of scope

- The Rank scan and Filter scan (they already use `DEFAULT_RULES` vs `DEFAULT_ETF_RULES`, which are separate per type).
- CSP, CC, PMCC and LEAPS IVR rules.
- Any change to scoring. This is a qualification gate only.

## Decisions needed (Ian, then Dean)

1. **ETF/index default: 15 or 20?** The screener's ETF rules and index minimum use 15, but the wheel (WHEEL-SYSTEM-0002) uses 20 for ETFs. Pick one number for the targeted scan, or confirm that they're meant to differ.
2. Should indexes (SPX, NDX, RUT) share the ETF floor, or get a third field?
3. Should `pending`/`unsupported` use the stock floor (proposed), or be excluded?
4. What ETF/index floor should each preset use?

## Ian's review (2026-09-29): APPROVE WITH CHANGES

"Right fix. One floor for SPY and a single name was never going to work. Approve with four answers and one code correction."

Code read: `runTargetedScan` gate at `app/screener/page.tsx` ~7688 (pre-filter) and ~7743 (per-symbol), `RULE_PRESETS` ~904, preset handler ~6884, `DEFAULT_ETF_RULES` / `INDEX_IVR_MIN` in `lib/scans/constants.ts`, `isLeveragedEtf` in `lib/wheel/capitalPlan.ts`.

1. **ETF/index default: 15.** Keep the targeted scan at 15, matching the screener's own ETF rules and the index minimum. The wheel's 20 is deliberately different: a cash-secured put carries assignment risk, so it asks for more premium. Spreads are defined-risk. Both numbers stay; the ticket documents why.
2. **Indexes share the ETF floor.** No third field. SPX and SPY sit in the same volatility regime, and a third row adds weight without a decision.
3. **`pending` / `unsupported` use the stock floor.** When the type isn't known, apply the stricter floor. Unsupported tickers can't be scanned anyway.
4. **Leveraged and inverse ETFs (TQQQ, SOXL, etc.) use the stock floor.** Their IVR swings like a single name's, not like a broad index. Reuse `isLeveragedEtf` (move it out of `lib/wheel` into a shared `lib/` module, not a copy).
5. **Preset ETF/index values** (roughly half the stock floor, rounded to the chip steps):

   | Preset | Stock | ETF / index |
   |---|---|---|
   | Strict | 40 | 20 |
   | Course | 30 | 15 |
   | Relaxed | 25 | 12 |
   | Low Vol | 20 | 10 |
   | Short Term | 35 | 18 |
   | Intermediate | 35 | 18 |

6. **Missing IVR still fails closed** at both floors (current `?? -1` behavior; consistent with CSP-IVR-0001). No change.

**Code correction for Dane:** the IVR gate runs *before* `classifyUnderlying` (the pre-filter uses market metrics only), so the scan doesn't know the type when it gates. The floor must come from the watchlist's stored `classification` (already on every `WatchlistTicker`) passed into `runTargetedScan`, falling back to `classificationCache`, then to the stock floor. Do not add an extra classify call per symbol before the gate.

## Tests (Quinn)

- Gate: a stock at IVR 25 fails at stock=30; an ETF at IVR 18 passes at ETF=15; an index at IVR 12 fails at ETF=15; `pending` uses the stock floor.
- Pre-filter and per-symbol gate agree (both paths use the same floor function).
- An old saved setting with a single `ivrMin` loads per item 4 above.
- Presets set both fields.
- Extract the floor choice into `lib/` (e.g. `lib/scans/ivrFloor.ts`) so it is unit-tested outside page.tsx.

## Mock (Diane)

Two rows in place of the current single MIN IVR % row, labeled "Stocks" and "ETFs & indexes", same chip style. Needs a mock before build.
