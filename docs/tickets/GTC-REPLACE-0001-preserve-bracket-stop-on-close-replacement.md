# GTC-REPLACE-0001 — Preserve the bracket stop when a close replaces an existing GTC

## Status

**DRAFT 2026-10-05. Ian: approve with changes. Paul: approved scope as one ticket. Quinn: review pending. Dean: approval pending.** Order path: full gates, full suite before push. Do not build before Quinn's review and Dean's approval. Build starts with the dry-run proof (step 1).

## Problem

Dean tried to close GGLL (short 96P, Oct 16) from the close-order dialog with "Replace existing GTC" checked. TradeEdge rejected it:

> The existing close is part of a complex/OCO order and TradeEdge does not have a complete, matched broker record of the paired leg...

The broker bracket was a TastyTrade OCO (complex order 8688606): `LMT 1.40 db GTC` profit target plus `STP 3.50 MKT GTC` stop, both Buy to Close 1.

Root cause (code, `origin/main` at 5b6a9f9):

- `resolveReconstructablePairedLeg` (`app/portfolio/page.tsx` ~1181) returns null when the paired leg has no limit price. A stop-market order never has one, so every stop-market bracket is refused. TradeEdge itself only places Stop Limit stops, so this hits brackets set up in TastyTrade.
- The refusal message blames missing broker data; the real reason is an unsupported stop type.

Investigation found larger problems in the same path:

1. **Successful replacement drops the stop.** The close dialog (`page.tsx` ~3450-3570) uses the paired leg only to restore on failure. On success it submits a plain Day/GTC limit close with no stop. If that close rests unfilled, the position has no stop and no warning. This already happens today for Stop Limit brackets.
2. **A working sibling exists.** Set/Edit Profit Target (`OCO_REPLACE`, `page.tsx` ~6990) already cancels the bracket, places a new OCO with a stop, and persists the stop policy (~6832). The close dialog duplicated the cancel logic without it.
3. **The sibling converts the stop on emergency restore.** Its fallback rebuilds the stop with `buildStopLimitBody` (~7069), turning a stop-market into a stop-limit.
4. **Stop record goes stale.** The close dialog never calls `postStopPolicies`, so after any replacement the new stop classifies as UNKNOWN_PROVENANCE on the next load.
5. **Stale evidence.** The paired leg comes from order evidence collected at page load; a stop edited in TastyTrade since then would be rebuilt at the old trigger.

## Rulings

**Ian (approve with changes):**
- Rebuild exactly; never convert. Stop-market stays stop-market: same trigger, quantity, legs, time in force. Missing any field: refuse and name the field.
- Single-leg only for stop-market. Multi-leg stop-market is not supported by TastyTrade; keep refusing (ES-0003 owns multi-leg stops).
- A replacement must never silently leave the position without its stop.
- Preserve the trader's own stop on Acquire/Wheel CSPs: never add or remove a stop in this ticket. (Confirm.)

**Paul (scope):**
- In: items 1-7 below. Out: multi-leg stop-market; any change to how stop levels are chosen; UI redesign (copy in the existing result row only; no Diane mock).

## Scope

1. **Stop-market reconstruction.** `ReconstructablePairedLeg.limitPrice` becomes optional; the paired leg resolves for `orderType: 'Stop'` without a limit price and for `Stop Limit` with one. Restore and replacement bodies omit `price` for `Stop`.
2. **Replacement keeps the stop.** When the cancelled GTC was part of a bracket, the replacement close is submitted as an OCO with the original stop (Day and GTC). Reuse the Set/Edit Profit Target OCO builder and safety gates; no second implementation.
3. **Fail closed before cancelling.** Build and broker dry-run the replacement bracket first. If it cannot be built or fails dry-run, refuse with the existing bracket untouched.
4. **Fresh evidence.** Re-read live orders immediately before cancelling; if the stop's trigger, type, quantity or legs differ from the evidence, refuse and ask the trader to refresh.
5. **Persist the new stop identity** (`postStopPolicies`, same as ~6832) after the replacement OCO is placed, so classification stays MATCHED.
6. **Fix the sibling's emergency restore** (~7069) to rebuild the stop exactly (no Stop Limit conversion).
7. **Partial close and batch.** Stop quantity equals close quantity; if a partial close would leave contracts without a stop, refuse. Each position in a batch gets its own cancel → replace → restore; one failure never leaves another position's state unknown.
8. **Messages.** Refusals name the actual reason (unsupported stop type, missing field, changed since load, dry-run rejection).

The unprotected window between cancel and submit (about 1 s) cannot be removed: TastyTrade has no atomic replace. The restore path is the mitigation and must stay.

## Build order

1. **Dry-run proof (Dane, with Dean).** On a single-leg short option: OCO of `Limit` (Buy to Close) + `Stop` (stop-market, Buy to Close), GTC/GTC and Day/GTC. Record accept/reject. If Day/GTC is rejected, the replacement goes in as GTC and the result row says so.
2. Quinn confirms whether the close dialog allows partial quantities (item 7).
3. Build items 1-8, tests, full suite, `tsconfig.check.json`, one push, CI green and current-head Vercel preview Ready.

## Tests (Quinn to extend)

- Stop-market paired leg resolves; Stop Limit unchanged; missing trigger, missing legs or multi-leg stop-market refuse with a named reason.
- Replacement (Day and GTC) submits an OCO carrying the original stop unchanged.
- Dry-run rejection refuses before any cancel.
- Changed-since-load stop refuses before any cancel.
- Replacement failure after cancel restores the full bracket with the stop type unchanged (both close dialog and Set/Edit Profit Target).
- New stop identity persisted after replacement.
- Partial close and batch rules.

## Open

- Quinn review.
- Ian: confirm the Acquire/Wheel CSP rule above.
- Dean: approve the ticket.
