# IVR-0002 — Separate Min IVR floors for stocks and for ETFs/indexes in the targeted scan

**Status:** DRAFT 2026-09-29. Needs Ian's sign-off (it changes which trades qualify) and Paul's scope approval before build. Owner: Dean Harmon.
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

## Tests (Quinn)

- Gate: a stock at IVR 25 fails at stock=30; an ETF at IVR 18 passes at ETF=15; an index at IVR 12 fails at ETF=15; `pending` uses the stock floor.
- Pre-filter and per-symbol gate agree (both paths use the same floor function).
- An old saved setting with a single `ivrMin` loads per item 4 above.
- Presets set both fields.
- Extract the floor choice into `lib/` (e.g. `lib/scans/ivrFloor.ts`) so it is unit-tested outside page.tsx.

## Mock (Diane)

Two rows in place of the current single MIN IVR % row, labeled "Stocks" and "ETFs & indexes", same chip style. Needs a mock before build.
