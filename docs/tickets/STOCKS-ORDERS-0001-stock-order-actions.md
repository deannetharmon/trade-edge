# STOCKS-ORDERS-0001 — Sell, Take Profit and Buy to Cover from Stock holdings

**Status:** **Correction (2026-09-27): items 1-3 and 5 are already built and live**, contrary to this line's "Not built" — confirmed by reading `features/portfolio/positions-workspace/SellStockDialog.tsx` (its own header comment cites "the mock approved 2026-09-22, Diane, with Ian/Quinn/Paul sign-off"), `lib/portfolio/stockOrderBuilder.ts`, `stockOrderSafety.ts`, `stockOrderSubmission.ts`, and `app/portfolio/page.tsx`'s `sellDeps` (a real `ttPost` to `/accounts/${accountNumber}/orders`, gated by `assertLiveContextReady`) — not a mock, not shipped dark. 42 existing tests pass. Same class of stale-status-line gap as PMCC-0001/AI-POLICY-0001A-B-F/LEAPS-PI-0001 found earlier this session — the build happened, the ticket's own status line was just never updated. **Item 4 (Take Profit for stocks) is the one piece not built** — only a passive "Target reached: consider selling" badge exists (`StockHoldings.tsx:97`, driven by `isPriceAlertCrossed`), not an actual Take Profit order type/flow. **Touches the order path:** any further work here (item 4) still needs Diane's mock and Alan/Ian's review first, per this ticket's own standing rule.

## Why

Position Analysis lets Dean close, roll and take profit on options, but there is no way to place a stock order from the app. STOCKS-0001 adds the holdings section without order actions on purpose.

## What already exists (reuse)

- `/api/tastytrade/order-dry-run`: authenticated and generic; it forwards any order body to the broker's dry-run for the user's account. Not option-specific.
- The broker order helpers (`ttValidateOrder`, `ttPost`) and the dry-run → confirm → submit dialogs, the header's Dry Run switch, the Audit Log, and the `submitCloseOrderIfSafe` pattern (verify the position immediately before submitting).
- The entry-record and decision-ledger capture (LEAPS-ENTRY-0001, LEAPS-LEDGER-0001) for recording what was ordered.

## What is new

1. **An equity order builder:** instrument type Equity; Sell to Close (long) or Buy to Close (short cover); integer shares; limit price (default at the bid for a sale); time in force.
2. **A hard safety gate, the important part.** Shares that back a covered call must never be sold: a sale would leave that call uncovered. The maximum sellable quantity is the holding's shares less 100 × the contracts committed to short calls or reserved by pending orders (the capacity model already tracks this: `allocatedContracts`, `reservedContracts`, `unallocatedShares`). Verified server-side immediately before submit, like the held-LEAPS check; never trusted from the screen.
3. **Quantity control** (all / part), a **taxable-lot notice** (selling shares is a taxable event and the broker picks the lots), and short-stock wording.
4. **Take Profit for stocks** is driven by the holding's own price alert target (there is no rule for stocks), not by a 50% option rule.
5. Tests for the gate (including a holding whose shares are fully committed, partially committed, and short), the builder, the dialog states, and that the dry-run route path is unchanged.

## Decisions resolved

- **Default time in force: GTC.** Decided 2026-09-21 (Dean).
- **"Buy to Cover" is OUT of v1** — Dean does not short stock directly; this account has no short-stock positions to cover. Long sales (Sell to Close) only. Decided 2026-09-21 (Dean). If this changes later, Buy to Cover is a separate, small addition to the same order builder — the safety gate and quantity model don't change.
- Default limit price: at the bid for a sale (already specified above under "What is new," item 1) — no separate decision needed.
