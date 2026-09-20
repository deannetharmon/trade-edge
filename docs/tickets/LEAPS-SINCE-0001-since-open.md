# LEAPS-SINCE-0001 — "Since you opened" tiles on the Positions income and cycle cards

**Status:** Approved by Dean 2026-09-20 ("do the next one"); implemented — see the [implementation report](../implementation/LEAPS-SINCE-0001-implementation-report.md)
**Design:** Diane's mock (the "vs open" arrows). **Policy:** Ian.

## Problem

The Positions cards showed where a held LEAPS is now, but not where it has gone: whether the stock has run, delta has faded, or volatility has dropped since you took the position.

## What already existed (correcting an earlier assumption)

The trade-entry snapshot store (`lib/entry-context`, TRADE-ENTRY-SNAPSHOT-0001) covers credit spreads and iron condors only. But the app also keeps a **position entry baseline** for every position (`/api/position-entry-snapshots`: stock price, delta, IV, IVR, DTE, greeks, recorded the first time the app sees the position; already carried on `Position` as `stockPriceAtEntry`, `deltaAtEntry`, `ivrAtEntry`, `entrySnapshotCreatedAt`, plus the broker's real `entryDate`). This ticket uses that store; no new capture or storage was needed.

## Scope

1. `lib/leaps-position-intelligence/sinceOpen.ts` (pure): `buildSinceOpen` and `SINCE_OPEN_POLICY`. Tiles: **Stock**, **Delta**, **IVR** (now, the move with an arrow, and the starting point), and **Extrinsic** (now and how much was lost) when the baseline is a true at-open baseline.
2. **Honest label.** The baseline is recorded when the app first sees a position. If that was within one day of the broker's real open date the section is titled **"Since you opened"**; otherwise **"Since first tracked <date>"**, and Extrinsic is left out (the stock price and greeks at the real open are unknown, so it would be a wrong number).
3. **Colours mean what the move does to a long call:** stock up and delta up = good; stock down, delta down and IVR down = amber; IVR up = good; extrinsic lost = neutral (expected). Moves under 0.05% (stock), 0.005 (delta) or 0.5 points (IVR) show as "unchanged".
4. Model: the held long's facts now also carry the entry baseline (delta converted to per share: position delta ÷ contracts) and the current IVR. Both cards show the section under "Your LEAPS".

## Non-goals

- No new capture: positions you already hold show "Since first tracked" from the first time they were recorded, not from the day you truly bought them (that data was never stored). New positions the app sees on their open day are labelled "Since you opened".
- No arrows for value or breakeven (those already compare to what you paid).
- No history chart.

## Acceptance criteria

1. Every tile, arrow, tone, threshold (flat / not flat for each), the at-open boundary (1 day yes, 2 days no), and each missing-data case is pinned by unit tests; extrinsic is never shown for a first-tracked baseline or when entry data is inconsistent.
2. The model carries per-share entry delta, entry stock price, entry IVR, capture time, open date and current IVR (pinned by a model test that fails without the builder change).
3. Existing Positions behavior and tests are unchanged.

## Rollout notes

No flag or environment variable. Rollback is a revert.
