# PMCC-HELD-LONG-FLAGGED-0001 — Held LEAPs that go OTM or lose extrinsic should be flagged, not dropped

## Status

**Draft, from the `SCAN-ALIGN-0001` second review (Ian, 2026-09-24). Not approved, not built.** Needs Paul scope and Diane mock (the flagged state is part of mock 3 in `SCAN-ALIGN-0001`).

## Problem

`LONG_NOT_ITM` and `INVALID_EXTRINSIC` (`lib/scans/pmccPairing.ts:167,183`) still apply to held longs. A held LEAP that has gone OTM or lost its extrinsic drops out of held review with no message.

## User value

That is exactly when the trader needs to see the position: a tested or broken LEAP needs a roll or exit decision, not silence.

## Scope (proposed)

- Held longs failing these checks stay visible, flagged with the named reason, with no short-call candidates or order action.
- New-entry behavior does not change.

## Non-goals

- Roll or exit recommendations (belongs to portfolio recommendation rules).

## Open questions

- Where the flagged row appears (held LEAP list vs. results banner). Diane.
