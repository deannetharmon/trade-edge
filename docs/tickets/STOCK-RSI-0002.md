# STOCK-RSI-0002 -- RSI on held LEAP call cards

Dean: show RSI on LEAPs too; above the covered-call cutoff means the underlying is ready for the PMCC income call.

- Option cards that are a single long LEAP call show: `<TICKER> RSI n` with arrow, `n at open`, and the `Calls: Ready/Wait` chip.
- Same daily RSI source and the same saved covered-call RSI cutoff (default 50) as the stock card, so the two never disagree.
- RSI is of the underlying stock. No `Recovery` state (that compares price to a share cost basis).
- `Show detail` adds the 30-session sparkline (cutoff line, open and now markers) and Now / Yesterday / At LEAP open.
- At LEAP open uses the broker's leg open date. It never estimates: outside the loaded window it shows a dash and a note.
- LEAP puts, short and multi-leg positions are unchanged.
- Files: `LeapRsi.tsx` (new), `PositionCards.tsx`, `__tests__/LeapRsi.test.tsx`.

## Sell PMCC button (PMCC-SELL-0001)

A held LEAP call with no short call open and an exact contract gets a **Sell PMCC** button on its card, beside Salvage. It uses the
same launcher as Existing-position income (`onFindPmccShortCall`), which opens the Screener's held-LEAP short-call review. No button
when a short call is already open, the contract is unknown, or the card is not a LEAP call.
