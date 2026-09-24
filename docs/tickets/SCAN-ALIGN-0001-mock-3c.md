# Mock 3c: held-LEAP outcomes on the existing held pair card (Diane, 2026-09-24)

**Supersedes Mock 3b for build.** Mock 3b assumed a results container, LEAP tile row, funnel and breakdown that do not exist (Dane's pre-build check). Mock 3c redraws only the three states on the EXISTING held pair card (`page.tsx` ~5467-5640). Approved copy from Mock 3b is unchanged unless listed under "Copy changes". Tiles, em dashes, results container, "Show full breakdown", funnel, "Adjust short delta" banner, tooltips and the rejected-pairs list move to follow-on ticket 0001C (own mock and approval). Status: draft; Ian re-checks the changed copy; Paul and Dean re-approve.

## Card placement (all states)

Existing card: header row (symbol, price, chart link, cyan `HELD LEAPS PMCC` tag, `Contract order N`, readiness label), two-column body (emerald HELD / amber SELL), red `Blocked because:` line, decision strip, expandable sections, `Show qualification and audit detail` toggle (contains `Pairing/accounting`, unchanged).
- **Caption:** tag at the right of the header row, before the readiness label.
- **Banner:** one amber/5 line directly under the header row, above the HELD/SELL columns.
- **Reason line:** one short ambient line under the banner: `Reason: CODE`.
- **Detail line:** first row inside the existing audit toggle, above `Pairing/accounting` (which stays untouched).
- No tiles, no em dashes, no funnel.

## State 1: cost basis unavailable (unit-suspect is the same card, in results: it needs spot)

```
UBER $151.20 [chart] [HELD LEAPS PMCC] [Cost basis unavailable]  Contract order 1
+--------------------------------------------------------------+
| ! Short calls were not checked. Cost basis for UBER could    |
|   not be read from your broker.        [Refresh Portfolio]   |
+--------------------------------------------------------------+
Reason: COST_BASIS_UNAVAILABLE
 HELD 60C . 2027-01-15 . 132 DTE . D0.82   (SELL column not rendered)
 Held contract . 1 contract(s) . OI 412
Show qualification and audit detail v
   Detail: cost basis unavailable. Avg open price missing or unusable.
   Pairing/accounting: ... (unchanged)
```
Unit-suspect: caption `Cost basis unavailable`; banner `Short calls were not checked. Cost basis for {symbol} looks wrong or could not be read from your broker.`; detail `Detail: cost basis unit suspect. Avg open price looks mis-scaled.`; `Refresh Portfolio` shown.

## State 2: multi-lot (in results, no action)

Caption `Multi-lot LEAP: cost unverified`; banner `Short calls were not checked. This LEAP has {qty} contracts, and cost averaging across lots is unverified.` (`{qty}` is the engine integer); reason `COST_BASIS_UNAVAILABLE`; detail `Detail: multi-lot LEAP: cost averaging unverified.` The existing `Held contract · N contract(s)` line stays.

## State 3: floor not met

Caption `Floor {floor} (LEAP strike + cost)`; banner `No short calls cleared the floor. A short must satisfy strike + bid > LEAP strike + your cost: {Kl} + {avgOpen} = ${floor}.`; reason `SHORT_NOT_ABOVE_HELD_BREAKEVEN`; detail `Detail: every short had strike + bid at or below ${floor}.` (replaces the funnel). **Fallback** if `avgOpen`/floor cannot be carried from the engine as pass-through data (no logic change): caption `Floor not met`, banner `Floor not met (strike + bid at or below LEAP strike + your cost)`, reason code in the reason line. Ian confirms the fallback.

## Multi-LEAP (per symbol)

`{SYM} · {n} held LEAPs · {a} with results · {c} no shorts cleared · {b} not checked` (new one-line ambient row; omit zero segments; counts sum to n; Dane confirms where per-symbol grouping lives). Card order: results, then floor-not-met, then not-checked; stable within groups; no re-sort on Refresh Portfolio. One LEAP's failure never hides another card.

## Discovery-time pre-modal error (existing `setError` + scan-modal close)

Only when EVERY selected LEAP has basis null/zero/unparseable or `held quantity invalid`. Unit-suspect is NOT here (needs spot). Red text: single `Could not read cost basis. Cost basis for {symbol} could not be read from your broker. Refresh Portfolio and try again.`; several `... Cost basis for {n} held LEAPs could not be read from your broker: {SYM1}, {SYM2}, {SYM3} +{k} more. Refresh Portfolio and try again.` Quantity invalid adds collapsed `Details: COST_BASIS_UNAVAILABLE, held quantity invalid`. Action `Refresh Portfolio`, then reopen ONCE; if it fails again the error stays; no auto-loop. Never for multi-lot or floor-not-met.

## Rejected styling (floor-failed, unit-suspect, multi-lot cards)

Neutral grey `Rejected` tag (`border-neutral-700`) plus the reason code; no near-miss styling, rank, score or green; no order/promote/trade button (the existing `tradeAllowed && !heldLong` already hides it; keep it hidden); inert; never sorted by margin below the floor. On these cards `Qualification and near-miss reasons:` reads `Rejection reasons:` (Ian confirms). Floor-failed cards may list rejected pairs (first 20 plus a count) only if the data is already in `nearMissPairs`; otherwise omit. Tests must prove a rejected held pair can never become the best pair or reach an order path (`serverTradeReview` `qualified[0] ?? nearMiss[0]`; A ticket W2 floor-failed case).

## Copy changes vs Mock 3b

Removed: tiles and em dashes, `Show details`/`Show full breakdown`, funnel row, `Adjust short delta`, tooltips, the `PMCC RESULTS` container line. Toggle label is the existing `Show qualification and audit detail`. New: a `Reason: CODE` line under the banner; the floor-fail detail line above; `Rejection reasons:` on rejected cards; fallback floor wording. Unit-suspect moved from pre-modal to in-results (its pre-modal body sentence and `Details:` line dropped). Multi-LEAP header includes `· {c} no shorts cleared`.

## Open for Dane

Where the per-symbol summary line lives; whether Extrinsic is computable without a basis (assumed yes); whether an `avgOpen`/floor pass-through exists in the engine result (decides banner versus fallback).
