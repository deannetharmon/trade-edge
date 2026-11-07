# STOCK-RSI-0001: daily RSI and basis-to-price movement on held-stock cards

Status: slice A built 2026-11-07 (Ian approved the mock and the changes below; Dean asked for it). Slice B not started.

## Slice A (built)
- New "RSI (14d)" tile on the Equity Holdings card (Portfolio): rounded RSI, a neutral arrow (last two completed closes, a move under 1 point reads flat), and a "Calls: Ready / Recovery / Wait" chip from lib/scans/ccRsiChip.ts using the saved covered-call cutoff (default 50). Short stock shows RSI with no chip.
- RSI is the same pipeline as the scan cards (completed daily bars, Wilder RSI 14), so the same ticker shows the same number everywhere. Unknown shows "—", never a made-up number.
- The number and arrow are not colored; only the chip carries color. Display only: no change to any verdict, score or order gate.
- Basis and Current price are one tile: `$80.00 → $71.20` (current price bold) with a neutral "−11.0% since you bought" caption. Incomplete basis says "Basis unavailable"; a missing price shows the average basis alone. The Reference price label for stale quotes is unchanged.

## Slice B (not started): RSI at entry
- Show "at entry N" and the detail sparkline only when the entry date is known. Broker holdings carry no purchase date today (EquityHolding has no date field), so B needs a source first: the assignment date from transaction history, and a user-set entry date (decided 2026-10-29) stored per user. Mixed-date lots show "multiple lots" and use the user-set date. Never estimate a date.
- Daily bars: /api/chart returns about 6 months (roughly 125 sessions, about 110 after the 14-bar warm-up), so entry dates inside roughly 5 months are reachable. Older entries show current RSI only.
- Diane's mock: canvas "Stock RSI Mock".
