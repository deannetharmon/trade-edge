# GTC-REPLACE-0001 — Preserve the bracket stop when a close replaces an existing GTC

## Status

**DRAFT 2026-10-05. Ian: approve with changes. Paul: approved scope as one ticket. Quinn: approve with changes (2026-10-06, below). Dean: approved 2026-10-06. Paul: Quinn's additions (exact-stop OCO builder, fail-closed in Set/Edit Profit Target, extraction to `lib/`) accepted into scope 2026-10-06. Ian: Quinn item 1 is his "rebuild exactly" rule; no new ruling needed.** Order path: full gates, full suite before push. Do not build before Quinn's review and Dean's approval. Build starts with the dry-run proof (step 1).

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
- Preserve the trader's own stop on Acquire/Wheel CSPs: never add or remove a stop in this ticket. **Confirmed 2026-10-06:** a bracket's stop is rebuilt exactly; a close replacing a plain GTC with no stop goes in without one; this ticket never adds a stop.

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

1. **Dry-run proof (Dane, with Dean). DONE 2026-10-06 (above).** On a single-leg short option: OCO of `Limit` (Buy to Close) + `Stop` (stop-market, Buy to Close), GTC/GTC and Day/GTC. Record accept/reject. If Day/GTC is rejected, the replacement goes in as GTC and the result row says so.
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

## Step 1 result: dry-run proof (2026-10-06 06:45Z, Dean's account, `scripts/gtc-replace-dryrun/gtc-replace-dryrun.js`)

| Case | Order | Result |
|---|---|---|
| A | MULL OCO: Limit GTC + Stop (stop-market) GTC | **Accepted** (HTTP 201) |
| B | MULL OCO: Limit **Day** + Stop (stop-market) GTC | **Accepted** |
| C | MULL OCO: Limit GTC + Stop Limit GTC (current builder) | Accepted |
| D | TQQQ OCO while closing order #511546370 is working | **Rejected** 422 `cannot_close_against_more_than_existing_position`: "You already have a closing order ... which must be canceled before this order can be routed." |

Only warning on A-C: `tif.next_valid_session` (run outside market hours).

**Consequences (Quinn's item 3 fallback applies; both paths):**
- Stop-market brackets are buildable exactly, as GTC/GTC and Day/GTC; no GTC substitution needed.
- A broker dry-run of the replacement cannot run while the original order is working. Sequence for the close dialog **and** Set/Edit Profit Target: (1) build the exact replacement and pass local safety gates; (2) re-read live orders (item 4); (3) cancel; (4) broker dry-run the replacement; (5) on rejection, restore the original bracket exactly and report; otherwise submit. Steps 3-5 widen the unprotected window by one dry-run round trip; the restore path covers it.
- Test added: dry-run rejected after cancel → exact restore, no replacement submitted.

## Quinn review (2026-10-06): approve with changes

Checked against `app/portfolio/page.tsx` and `lib/portfolio/protectionOrders.ts` at `d2536ce`.

1. **The OCO builder converts too.** `buildOcoBody` (`protectionOrders.ts` ~86) always builds the stop with `buildStopLimitBody`. Reusing it as scope item 2 says would turn a stop-market into a stop-limit on the *success* path, not just the restore. Add an exact-stop variant (`buildOcoBodyWithStop(legs, limit, pairedLeg)`) that copies type, trigger, limit (Stop Limit only), quantity, legs and TIF; the Set/Edit Profit Target path keeps its own behaviour when it creates a new stop.
2. **The sibling does not fail closed either.** Set/Edit Profit Target cancels (~7104) before any broker dry-run. Item 3 applies to both paths, or the close dialog becomes safer than the sibling it reuses.
3. **Dry-run with the bracket still working is unproven.** Dry-running a second Buy to Close OCO while the original is working may be rejected for exceeding the closeable quantity. Build-order step 1 must include that case. If TastyTrade rejects it, fall back to: local build + safety gates before cancel, broker dry-run right after cancel, restore on rejection. Record which one in the ticket.
4. **App Dry Run mode cannot prove this flow.** The close dialog skips the whole cancel block and the fresh-price check when Dry Run is on (`!dryRun &&` ~3505, ~3547). Step 1 uses the broker `/dry-run` endpoint (`ttValidateOrder` ~1204) in live mode; the result row must say which checks ran.
5. **Partial close: not reachable.** The close dialog always closes the full closeable quantity (`requestedQuantity` = `closeableQuantity`, ~3428). Item 7 reduces to an assertion (stop quantity = close quantity, else refuse) plus a test; build-order step 2 is answered.
6. **Testability.** `resolveReconstructablePairedLeg` (~1185) and the cancel → place → restore sequence live in `page.tsx`. Move them to `lib/portfolio/existingGtcReplacement.ts` (next to `cancelExistingGtcForReplacement`) with injected broker calls, so every test below runs without the page.
7. **Tests added:** the OCO builder preserves stop-market exactly (no `price` field); Set/Edit Profit Target refuses before cancel on dry-run rejection; restore after a failed replacement keeps the stop type in both paths; the stop-quantity assertion; a batch where item 2 fails leaves items 1 and 3 in a stated final state.

Risk: order path. Full suite, `tsconfig.check.json`, one push, CI green and current-head Vercel Ready.

## Open


## Build sign-off (2026-10-06)

- **Ian:** approved. The extra second of exposure is acceptable because restore is exact. Condition: if the live re-read (step 2) shows the stop already triggered, filled or cancelled, refuse and say so; never rebuild a stop that is no longer working.
- **Quinn:** approved with the post-cancel dry-run sequence and the test list below.
- **Paul:** scope unchanged (items 1-8 plus Quinn's additions); approved for build.

## Dane: approved build instructions

Order path: full suite, `tsconfig.check.json`, one push, merge after CI green and current-head Vercel Ready.

1. **New `lib/portfolio/existingGtcReplacement.ts` logic** (next to `cancelExistingGtcForReplacement`), broker calls injected:
   - `resolveReconstructablePairedLeg` moved out of `page.tsx`. `limitPrice` optional: required for `Stop Limit`, absent for `Stop`. Refuse with a named reason for: missing trigger, missing legs, multi-leg `Stop`, unknown order type.
   - `buildExactOcoBody(closeLegs, limitPrice, closeTif, pairedLeg)`: the target is the trader's close (Day or GTC); the stop copies type, trigger, limit (Stop Limit only), TIF, legs and quantity from the paired leg; `Stop` has no `price` / `price-effect`.
   - `buildExactStopBody(pairedLeg)` for restores.
   - `replaceBracket(deps)`: (1) build + local safety gates; (2) re-read live orders, refuse if the stop differs from the evidence or is no longer working (Ian); (3) cancel; (4) broker dry-run the replacement; (5) rejected → restore the original bracket exactly (OCO of original target + exact stop) and report; accepted → submit; submit failure → same restore; restore failure → the existing UNPROTECTED message.
   - Assert stop quantity = close quantity, else refuse before cancel.
2. **Close dialog** (`page.tsx` ~3500): when the cancelled GTC was part of a bracket, call `replaceBracket`; persist the new stop identity with `postStopPolicies` (as Set/Edit Profit Target ~6926). A plain GTC with no stop keeps today's path and never gains a stop.
3. **Set/Edit Profit Target** (`page.tsx` ~7100-7190): when replacing an existing bracket, use the same `replaceBracket` sequence; emergency restore uses `buildExactStopBody`, never `buildStopLimitBody`. New stops the trader creates there are unchanged (Stop Limit).
4. **Messages** in the existing result row: name the reason (unsupported stop type, missing field, changed since load, stop no longer working, broker dry-run rejection with its text).
5. **Batch:** each position runs its own sequence; one failure never stops or hides another's final state.
6. **Tests** (`lib/portfolio/__tests__/existingGtcReplacement.test.ts` plus page-level where needed):
   - paired leg: Stop resolves without limit; Stop Limit unchanged; missing trigger / legs, multi-leg Stop refuse;
   - exact OCO: Stop has no `price`; Day and GTC targets;
   - changed-since-load and stop-no-longer-working refuse before cancel;
   - dry-run rejected after cancel → exact restore, no replacement submitted;
   - submit failure → exact restore (both paths), stop type unchanged;
   - restore failure → UNPROTECTED message;
   - stop identity persisted after replacement;
   - quantity assertion; batch where item 2 fails leaves items 1 and 3 in a stated final state.
7. Sibling search before push: every `buildStopLimitBody` / `buildOcoBody` call site used for a *restore* or *replacement*.
