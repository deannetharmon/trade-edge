# ORDER-PCT-INPUT-0001 — Percent and price inputs, kept in sync, for profit targets and stops

## Status

**MOCK APPROVED 2026-10-05 (Dean, Diane with changes, Ian with rulings) — Quinn pending.** Order-entry UI: build after Quinn's review.

Mock (interactive): https://claude.ai/artifact/Ln4e9PgkBBkNU19pnvdRD6

## Problem (Dean, 2026-10-05)

Dean thinks in percentages: "if I enter a percentage it shows me the number; if I adjust the number it shows me the percentage." Today:

| Dialog | Profit target | Stop |
|---|---|---|
| Review order (`BatchConfirmModal`, Place GTC / Close) | `Limit $` only (`app/portfolio/page.tsx` ~4135) | — |
| Add Stop / Set Profit Target (`SetStopLossButtonInner`) | `Profit target $` only, hidden under "Exact prices and details" (~7490) | % slider (`StopPctSlider`, ~7334) plus ×credit and `$` boxes, also hidden (~7505-7540) |

So the profit target has no percentage anywhere, and the stop percentage can only be dragged, not typed.

## Scope

1. **Profit target, both dialogs:** a "% of credit kept" box beside the price box. `price = credit × (1 − pct/100)`; `pct = (1 − price/credit) × 100`, rounded to whole percent for display. Editing either updates the other. Default 50%.
2. **Stop, Add Stop dialog:** a typed "% of original credit" box beside the `Stop trigger $` box, both shown (not collapsed); the existing slider drives both. `trigger = credit × pct/100`. Default 200% (2x). Reuses the existing wording "Stop loss % (of original credit)" — one name per concept.
3. **P/L readout** under each pair: "If filled: +$270.00 (50% of the $540 credit kept)", "If triggered: −$540.00 (2.00x credit)".
4. **Credit positions only.** Debit positions (LEAPS, bought options) keep today's controls.
5. **Every existing gate unchanged:** price min/max and valid-range checks, `submitCloseOrderIfSafe`, OCO body, stop provenance (`stopPriceSource` / `stopBasisOverride`: typing a % is an ORIGINAL_CREDIT anchor, typing $ is MANUAL_ABSOLUTE, as the ×credit and $ boxes record today).

**Out:** changing default levels or the stop policy; debit-position percent inputs; GTC-REPLACE-0001.

## Rulings (2026-10-05)

**Diane (approve with changes):**
- The stop's "If triggered" line is risk context: calm orange like its label, not bold. The target line stays green.
- An invalid entry shows directly under the box typed in; submit stays disabled until fixed.
- Each %/$ pair stacks vertically below ~420 px.

**Ian (approve with rulings):**
- Prices sent are rounded to a valid tick for the contract (TastyTrade tick table: $0.01 below $3.00, $0.05 at or above, per the chain's `tick-sizes`), then the % shown is recomputed from the sent price, e.g. "30% (sent: $3.80, 29.6%)".
- Defaults: target 50%, stop 200% for spreads and Income puts. Acquire and Wheel cash-secured puts: stop **Include starts unchecked** (assignment is the plan; consistent with ACQUIRE-WHEEL-LIVE-0001). The trader can still check it.

## Open

- Quinn: tests that both directions round-trip, invalid entries keep the submit blocked, provenance is recorded as above, and the order body sent is unchanged for the same price.
- Seen while reading: the Review order `Limit $` label has a broken class `text-[9px}` (~4135); fix in this ticket.
