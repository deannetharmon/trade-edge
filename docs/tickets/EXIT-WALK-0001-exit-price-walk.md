# EXIT-WALK-0001: exit-price walk (midpoint walk for Sell to Close / Buy to Close)

Status: slice A IMPLEMENTED 2026-10-17 (`lib/exit-walk/`, 45 tests, unwired: no production caller). Slice B (click-to-walk) IN PROGRESS: Diane's mocks v4, Ian (C1, C2), Paul, Quinn's list approved 2026-10-17. Steps 1 (`run.ts` step loop), 2 (`browserDeps.ts`, dry-run deps), 3a (`closeOrder.ts`: order body, eligibility, safety gate) and 3b (`panelModel.ts`, `components/portfolio/ExitWalkPanel.tsx`, three additive edits in `app/portfolio/page.tsx`) are BUILT. Remaining: Dean's C2 dry run on the Vercel preview, Quinn's full-suite pass, merge.
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

## Slice B step 1 verification (2026-10-17)
`npx vitest run lib/exit-walk`: 83 passed (45 slice A + 38 step loop). `npx tsc --noEmit -p tsconfig.check.json`: exit 0. Mutation checks: direction flipped (17 fail), Stop check removed (2 fail), cancel confirmation skipped (1 fail). Sibling check: no Map/Set iterator spreads, no clock/random/timers/network in run.ts (guard test), only importer of `lib/entry-walk/walk` types is run.ts. Not run: full suite (asked first per CLAUDE.md).

## Slice B step 3 (2026-10-17)
Mount: its own panel launched by a "Walk the price" button on a position's action row (`ExitWalkLauncher`). The batch close modal (`BatchConfirmModal`) and its submit path are untouched. Page edits: one import, the launcher in `PositionCard`'s action row, and `ExitWalkProvider` around the position sections (supplies pending orders, the Dry Run flag and a refresh callback).
Refuses to start (`checkExitWalkEligibility`): unclear structure, unknown entry, ANY working order on the position's legs (the walk never cancels someone else's order), outside the 9:30-16:00 ET session. Also refuses (`checkWalkStart`): hard-risk exit (confirmed stop breach), quote missing/stale/crossed, opening window, boundary beyond start.
Every price, including the first, passes `runLiveCloseOrderSafetyGate` (pricing intent CUSTOM) with the live quote; the gate runs on the NEXT price before the cancel, so a refusal leaves the working order alone. Orders are always Day. Start walk re-reads the market at the click and, if the prices changed, shows the new ones and waits for another click. Dry Run ON validates every price at /orders/dry-run and places nothing.
Known limits (flag to Ian/Paul):
- The gap rule (A-series, DECIDE-0001 S2) is not built, so `gapBlocked` is false; the walk is user-started and every price is gated, but a gap day is not blocked by rule yet.
- Hard-risk uses the existing `stopLossBreachState === CONFIRMED_BREACH`, not DECIDE-0001's new stop definition (S2).
- The safety gate refuses a price more than 30% from the marketable price (MATERIAL_PNL_DEVIATION). On a very wide market the mid itself can exceed that: the walk then refuses to start with the gate's message. The threshold was not changed (Ian's call).
- Session check ignores holidays and early closes (trading-day calendar is S2).
- No fill log / audit entry yet beyond the broker's own order history; positions refresh after the walk ends.
## Verification (step 3)
Targeted: 151 exit-walk tests plus 10 existing files that read the portfolio page (402 tests in 21 files) pass; tsc (tsconfig.check.json) exit 0. Full suite: CI on push.
