# EXIT-WALK-0001: exit-price walk (midpoint walk for Sell to Close / Buy to Close)

Status: slice A IMPLEMENTED 2026-10-17 (`lib/exit-walk/`, 45 tests, unwired: no production caller). Slice B (click-to-walk button) NOT STARTED: needs Diane's mock and its own approval.
Origin: the Position Decision Engine epic (Dean, 2026-10-17), folded into DECIDE-0001. This ticket is the A17 amendment: start at the mid, step toward the market only as needed, stop at a boundary re-derived from the live quote.
Approvals: Ian (approved click-to-walk for exits, with conditions below), Paul (new slice, pure math first), Alan (formulas and goldens), Quinn (test list), Dean (fold into DECIDE-0001; stop = mark at 2x credit; no 21-DTE on CSP/CC; leveraged ETFs are not covered by the unconfirmed-Acquire default).

## Rules (slice A)
- Integer cents, whole-percent settings, no clock (`nowMs` is passed in), no UI, no order path.
- Spread = ask - bid; mid = (bid + ask) / 2; maxSlippage = maxSlippagePct x spread (default 50%: the boundary is the live bid / ask).
- Sell to close walks DOWN from the mid to `floor = max(bid, mid - maxSlippage)`, rounded UP to a tick. Buy to close walks UP to `ceiling = min(ask, mid + maxSlippage)`, rounded DOWN to a tick. A sell with a zero bid uses a 5c floor.
- Start = nearest tick to the mid (an exact tie goes toward the market), held to the boundary. Optional favorable-side start offset (default 0, bounded by the quote).
- Step = 10% of the spread, rounded to the tick at the start (ties to the smaller step), never below one tick. The tick is re-checked at every price, so a walk that crosses a tick band stays on valid prices.
- Re-anchor: if the mid moves by more than one step since the schedule's anchor quote, rebuild from the live quote and keep the step index. Otherwise keep the schedule and clamp it by the boundary re-derived from the live quote.
- Halts (no prices): bad settings, missing quote, crossed/unreadable quote, stale quote (older than 60 s), opening window (09:30:00 to 09:45:00 ET, New York time, DST-correct), boundary beyond the market.
- Spread flag: spread more than 10% of the mid; integer test `20 x (ask - bid) > bid + ask` (strict). Not the 25% test (`8 x ...`) used for DECIDE-0001's wide-quote state.
- Every result carries derivation basis text and the tick source (`table` or `fallback_0.01`).

## Tick table
Not stored in the repo: TastyTrade publishes it per option root (`tick-sizes`), read by `lib/portfolio/tickSize.ts`. The walk takes the table as an input; goldens run against T1 (penny), T2 (the documented $0.01 below $3 / $0.05 above) and a synthetic 5c table. A real-table fixture for the MRNA and TQQQ roots waits for the Oct 17 chain data or one live read.

## Open defaults for Ian
- Stale-quote limit 60 s and per-step dwell 90 s are first defaults, configurable.
- Opening-window check is time of day only; the trading-day calendar belongs to S2.

## Not in this slice
Gap rule, data-validity gate, hard-risk marketable-limit exception, level classes, dependencies, beta/sector cap (S2 / S3-B / P2, see DECIDE-0001). Slice B conditions (Ian): never auto-starts; no walk in the opening window, on a stale quote or on a gap-rule block; hard-risk exits skip the walk; floor never worse than the live bid (sell) and ceiling never beyond the live ask (buy).

## Verification (2026-10-17)
`npx vitest run lib/exit-walk`: 45 passed. `npx tsc --noEmit -p tsconfig.check.json`: exit 0. Mutation check: floor rounding flipped (4 tests fail), sell direction flipped (11 fail), spread flag switched to the 25% formula (4 fail); restored, 45 pass. Sibling check: no Map/Set iterator spreads, no clock or random, no imports from app/features/components, no importers outside `lib/exit-walk/`.
