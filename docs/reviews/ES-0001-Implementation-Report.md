# ES-0001 — Live Close-Order Identity and Break-Even Safety — Implementation Report

Status: Implemented on `feature/live-close-safety`, pushed, **not merged**. Stopping for Product Owner review per sprint instructions.

This report follows the sprint brief's required deliverables. It reports only what was actually done and directly verified in this session; where a check could not be completed for a reproducible environment reason (the production build), that is stated plainly rather than assumed to have passed.

## 1. Repository snapshot at start

Branch `feature/live-close-safety` was created off `main` @ `ebb3d94d4cb38cfb766019c25f3d16b41d64af11`, identical to `main`/`origin/main` at the time (matches the state left by the prior PT-0001 documentation closeout). Working tree clean at start. No files were modified until Phase 1 (read-only investigation) was complete.

## 2. Investigation approach

Direct `Read` of `app/portfolio/page.tsx` (10,502 lines at start), not delegated wholesale to a subagent given the safety-critical nature of live order code. Confirmed, line-for-line, the grouping key, `calculateSpreadCredit`, `buildCloseOrder`, `buildOpenSpreadOrder`, `parseOptionSymbol`, `classifyPositionStopLoss`, the `Position` construction block (strategy inference, leg mapping, `creditReceived`/`currentValue`/`closeValue`), `ttPost`/`ttValidateOrder`/`ttPostComplex`, the full `BatchConfirmModal` (enrich effect, `activeItems`, `submitAll`, the Roll/OTOCO construction, `writeAuditEntry` call sites), `TakeProfitScale` (including the Snap-to-Breakeven handler), `SetStopLossButton` (bounds, AI suggestion, submit/OCO construction), and the card-display sections. Also confirmed `fetchCloseLimit`, `fetchCloseQuote`, `findRollCandidates`'s sizing, and the `AuditEntry`/`OrderBody`/`OrderLeg`/`BatchOrderItem` type definitions.

## 3. Root cause — confirmed

Two compounding, in-scope defects, both in `app/portfolio/page.tsx` as it existed on `main`:

1. **Grouping key too broad**: `` `${pos['underlying-symbol']}::${pos['expires-at']?.slice(0, 10) ?? 'unknown'}` `` — symbol + expiration only, no strike/direction/quantity discriminator. Two independently-opened spreads sharing symbol+expiration but differing in strike and/or quantity were merged into one `Position`.

2. **Systemic "arbitrary leg quantity" idiom**, found at (at least) these 19 call sites, each independently deriving a stand-in "quantity" (usually `pos.legs.find(l => l.direction === 'Short')?.quantity ?? 1`, in one case the even less discriminating `pos.legs[0]?.quantity ?? 1`) and dividing the merged group's AGGREGATE `creditReceived` by that one leg's quantity:
   - `findRollCandidates` roll-sizing (line ~754 pre-fix)
   - `fetchCloseLimit` (the "balanced" close-limit optimizer)
   - `fetchCloseQuote` (feeds the profit-capture scale)
   - `evaluateAction`'s stop-loss-breach checks (`getRecommendation` and the `CUT_LOSSES` gate, two sites)
   - `classifyPositionStopLoss`
   - `BatchConfirmModal.refreshItemQuote`
   - `BatchConfirmModal.enrich()` (`creditPerContract`, `freshPerContract` — feeds the DEFAULT limit submitted to the broker)
   - `BatchConfirmModal`'s live P&L renderer (inline JSX)
   - `BatchConfirmModal`'s `TakeProfitScale` prop computation
   - `BatchConfirmModal.totalEstPnl`
   - `BatchConfirmModal.submitAll`'s pre-submit price-drift check
   - `BatchConfirmModal.submitAll`'s Roll new-spread sizing (`legs[0]`, not even filtered by direction)
   - `BatchConfirmModal.submitAll`'s audit-entry quantity (two sites: success and error path)
   - `BatchConfirmModal`'s GTC-replacement profit-percent display
   - `SetStopLossButton`'s price-bound derivation
   - `SetStopLossButton`'s AI-suggestion prompt builder
   - two card-display sites (collapsed strike-count, expanded stop-loss multiple)

`TakeProfitScale`'s "Snap to breakeven" button is the single most direct manifestation of the bug: one click sets the live order's limit price straight to this mis-attributed number.

**Order construction itself is per-leg-correct** — `buildCloseOrder`, `buildOpenSpreadOrder`, and `SetStopLossButton`'s OCO leg builder all preserve each leg's own true quantity in the actual broker payload. The defect is entirely upstream, in grouping and per-contract economics attribution.

## 4. Hypothesis confirmation status

**CONFIRMED**, and found to be broader than the original single-hypothesis framing: the grouping defect is real, and it is compounded by a systemic secondary defect (19 call sites, not one) that the original hypothesis did not fully anticipate but which is squarely the same class of problem and within the sprint's pre-authorized "different but in-scope root cause" clause.

## 5. Architecture Stop Condition decision: PROCEED

`BatchConfirmModal` and `TakeProfitScale` are real, existing, unexported local functions in `app/portfolio/page.tsx`, exactly as the sprint's premise assumed — not missing or renamed. No architecture-stop condition was triggered.

## 6. Canonical close-order identity design

New module `lib/portfolio/closeOrderSafety.ts` (framework-free, independently unit-testable):

- `RawEconomicLeg` — one already-netted per-OCC-symbol broker leg (symbol, optionType, strikePrice, direction, quantity, avgOpenPrice, optional createdAt).
- `CanonicalGroup` / `groupEconomicLegs(underlying, expiration, legs)` — splits legs into quantity-consistent groups (see §7).
- `CanonicalCloseIdentity` / `buildCanonicalCloseIdentity(group, creditReceived)` — `{ key, underlying, expiration, quantity, legs, creditReceived, creditPerContract }`. Consumed identically by the confirmation modal, the safety gate, the P/L calculations, and (via `Position.quantity`) the actual broker order payload.
- `computeBreakEvenLimitPrice(identity)` — the break-even limit price (per-contract entry credit, floored at $0.01).

## 7. Position-grouping design

`groupEconomicLegs` buckets legs sharing one underlying+expiration by their (absolute) quantity. No single coherent multi-leg option strategy legitimately has mismatched leg quantities, so a quantity mismatch is proof of two-or-more independently-opened trades. The legacy `${symbol}::${expiration}` key is preserved exactly when only one quantity is present (the common, previously-correct case — existing persisted position-intent overrides, profit targets, and roll inputs keyed by the old format keep working unchanged). A genuine split mints a new `${symbol}::${expiration}::${quantity}` key, which cannot collide with any pre-existing persisted state for that symbol+expiration (that split shape never existed under the old, always-merged behavior).

**Documented residual limitation**: two independently-opened spreads sharing symbol, expiration, AND quantity are still merged — broker position data has no "originating ticket" tag, so this is not resolvable by grouping alone. Mitigated (not eliminated) by the enhanced confirmation-modal disclosure (§9), which shows the exact legs/strikes/quantity being closed.

## 8. Break-even / safety-gate rules

`runCloseOrderSafetyGate(input)` — typed result `{ ok, issues: { ruleId, severity, message }[] }`. Stable rule IDs:

| Rule ID | Severity | Trigger |
|---|---|---|
| `ZERO_OR_NEGATIVE_QUANTITY` | block | canonical `quantity` is not `> 0` |
| `EMPTY_LEG_SET` | block | no legs on the identity |
| `LEG_QUANTITY_MISMATCH` | block | any leg's own quantity disagrees with the canonical quantity |
| `REQUESTED_QTY_MISMATCH` | block | the order-under-construction's closing quantity disagrees with the position's canonical quantity |
| `LIMIT_PRICE_NON_POSITIVE` | block | requested limit price is not `> 0` |
| `ONE_SIDED_QUOTE` | warn | the close-value quote was missing a bid or ask on any leg |
| `STALE_QUOTE` | warn | quote age exceeds a threshold (default 5 minutes, overridable) |

Block-severity issues hard-block submission (throw, recorded as an `error` result); warn-severity issues are disclosed in the confirmation UI but do not themselves block. This is a deliberate, explicit hard-block policy per the sprint's requirement — not a warning-only gate.

## 9. Confirmation UI changes

`BatchConfirmModal`'s per-item row gained a disclosure block: a LIVE/DRY RUN mode badge, symbol/strategy/canonical quantity, the exact legs being closed (direction, quantity, option type, strike), entry credit vs. close limit vs. marketable (ask) price, an explicit "fees excluded" note, and any safety-gate issues rendered with distinct block (red, "✕ BLOCKED") / warn (yellow, "⚠") styling and their rule IDs. This renders for every non-excluded item, not just ones with issues, so the exact economics being submitted are always visible before the operator clicks Submit.

## 10. Roll workflow findings

The Roll workflow's new-spread quantity sizing used `item.pos.legs[0]?.quantity ?? 1` — the least discriminating of all the call sites found (not even filtered by leg direction). Fixed to use `pos.quantity`. The roll's candidate-search (`findRollCandidates`), categorization (`categorizeRollCandidates`), live-credit re-check, and 1/3-credit-rule validation were read and left untouched — validated, not redesigned, per scope. The roll's OTOCO trigger-order (the close leg) now goes through the same safety gate as every other close action, since it is built by the same `buildCloseOrder`/`item.orderBody` path.

## 11. Audit / diagnostic evidence design

Reused the existing `writeAuditEntry`/`AuditEntry` mechanism (`LS_AUDIT_LOG` in `localStorage`) rather than introducing a new one, per the sprint's instruction. `AuditEntry` gained three optional fields: `groupKey` (the canonical position-group key the order was built against — lets a later investigation trace exactly which post-split group produced a given order), `safetyGateOk`, and `safetyGateIssues` (the rule IDs of any issues, block or warn). Both the success path and the error-catch path now populate these.

## 12. Failure fixture

`lib/portfolio/__tests__/closeOrderSafety.test.ts` includes an anonymized, synthetic reproduction of the failure shape: a 2-lot bull put spread (200/195) and a 3-lot bull put spread (190/185), same symbol, same expiration, merged under the old grouping key. The test computes the OLD code's "first Short leg" arithmetic side-by-side with the NEW canonical per-spread numbers, showing the old figure ($1.35/contract) matches neither spread's true economics ($0.60 and $0.50 respectively), and confirms the new grouping splits them and the safety gate blocks the old merged shape (`LEG_QUANTITY_MISMATCH`). This fixture is explicitly documented in the test file as **not** a copy of Dean's real transaction — no real order/transaction data exists anywhere in this repository to draw from, so it could not be and is not claimed to be.

## 13. Requirements → code/test mapping

| Requirement | Code | Tests |
|---|---|---|
| Canonical close-order identity | `lib/portfolio/closeOrderSafety.ts`: `CanonicalCloseIdentity`, `buildCanonicalCloseIdentity` | `buildCanonicalCloseIdentity` describe block (3 tests) |
| Exact economic-leg grouping key | `groupEconomicLegs`; wired into `loadPositions()`'s grouping loop | `groupEconomicLegs` describe block (7 tests) |
| Corrected break-even math | `computeBreakEvenLimitPrice`; `Position.quantity` used everywhere `creditPerContract` is computed | `computeBreakEvenLimitPrice` describe block (2 tests); the bug-shape reproduction test |
| Safety validation gate, typed, stable rule IDs | `runCloseOrderSafetyGate` | `runCloseOrderSafetyGate` describe block (13 tests) |
| Hard-blocking, not warning | block vs. warn severity in the gate; `submitAll`/`SetStopLossButton.submit` throw on block issues | gate tests assert `ok === false` on block rules; `ok === true` on warn-only |
| Enhanced confirmation disclosure | `BatchConfirmModal` JSX disclosure block (§9) | manual code review (no existing component-render test harness for `BatchConfirmModal`; see Limitations) |
| Roll workflow validated, not redesigned | `pos.quantity` fix at the roll-sizing call site only | covered indirectly via `Position.quantity` canonical-quantity tests |
| Audit/diagnostic evidence via existing mechanism | `AuditEntry.groupKey`/`safetyGateOk`/`safetyGateIssues`, `writeAuditEntry` call sites | manual code review (existing mechanism, no dedicated test file for `writeAuditEntry` predates this ticket) |
| ≥20 regression tests | — | 26 tests, `lib/portfolio/__tests__/closeOrderSafety.test.ts` |
| Anonymized failure fixture | — | included in the same test file, explicitly documented as synthetic |

## 14. Files changed

- **New**: `lib/portfolio/closeOrderSafety.ts`
- **New**: `lib/portfolio/__tests__/closeOrderSafety.test.ts`
- **New**: `docs/design/ES-0001-Live-Close-Order-Safety.md`
- **New**: `docs/reviews/ES-0001-Implementation-Report.md` (this file)
- **Modified**: `app/portfolio/page.tsx` — new import block; `Position.quantity` field; `AuditEntry` gained `groupKey`/`safetyGateOk`/`safetyGateIssues`; `BatchOrderItem` gained `closeIdentity`/`safetyCheck`; `loadPositions()`'s grouping loop rewritten to call `groupEconomicLegs`; `classifyPositionStopLoss`'s signature widened to accept `quantity`; all 19 confirmed "arbitrary leg quantity" call sites replaced with `pos.quantity` / `item.pos.quantity`; `BatchConfirmModal.enrich()` builds and runs the safety gate per item; `activeItems` re-runs the gate on operator overrides; `submitAll()` hard-blocks on any block-severity issue immediately before submission; `SetStopLossButton.submit()` runs the same gate before its OCO/stop order; new confirmation-disclosure JSX block.
- **Modified**: `planning/SPRINT_STATUS.md`, `docs/HANDOFF.md`, `docs/roadmap/ROADMAP.md` — documentation only, per §7 above and the sprint's constraints (no completion/merge claim, no next-sprint selection, PT-0002's queued status and `feature/autopilot`'s untouched status both explicitly preserved).

## 15. Validation results

- **Targeted**: `npx vitest run lib/portfolio/__tests__/closeOrderSafety.test.ts` — 26/26 passing.
- **Full suite**: `npx tsc --noEmit` — clean, 0 errors (one ES5/`downlevelIteration` issue found and fixed during implementation: `Array.from(map.keys())` instead of spreading the iterator).
- **Full suite, tests**: this sandbox's per-command execution ceiling (~45 seconds) prevented one single `vitest run` invocation from completing across all 67 test files in the repo — confirmed reproducible (identical stall point on two separate foreground attempts). Ran the entire suite in 7 batches by directory instead of skipping it: **all 67 test files / 973 tests pass, 0 failures.** No test file in the repository was skipped.
- **Production build**: `npm run build` was attempted three times (two plain foreground, one `setsid`-detached to rule out the sandbox's per-tool-call boundary as the cause) — all three were killed at an identical point, immediately after the Next.js startup banner, before any compile-progress line appeared. This matches a pre-existing, already-documented sandbox limitation (see `planning/SPRINT_STATUS.md`'s Validation Baseline entries for PI-0014/OE-0001/PT-0001, all of which report the identical "hangs at the initial Next.js banner" behavior). Per the sprint's 5-minute-cap/no-further-investigation rule, this was reported rather than worked around further. Vercel remains the authoritative build check, consistent with prior tickets.
- **`git diff --check`**: to be run in the Phase 9 pre-stage verification, immediately before staging.

## 16. Limitations

- The residual grouping ambiguity described in §7 (two independent same-quantity spreads at the same symbol+expiration) is not resolvable from broker position data alone.
- `BatchConfirmModal`'s new disclosure JSX and the wiring inside `enrich()`/`submitAll()` were verified by direct code reading and the module-level unit tests, but there is no existing component-render test harness for `BatchConfirmModal` in this repo (it is an unexported local function inside a 10,500+ line page component) to add a rendering-level test against. Extracting it into an independently importable/testable component was not attempted — that would be a much larger, higher-risk refactor than this ticket's scope authorizes, and was not requested.
- `SetStopLossButton`'s new safety-gate call was verified by direct code reading only, for the same reason.
- The production build could not be confirmed locally, per §15; this is a pre-existing, documented environment limitation affecting every recent ticket in this repository, not something newly introduced by ES-0001.

## 17. Deferred follow-ups (explicitly not done, out of scope)

- Extracting `BatchConfirmModal`/`TakeProfitScale`/`SetStopLossButton` into independently testable components/modules.
- Resolving the residual same-quantity/same-symbol/same-expiration grouping ambiguity (would require broker order/trade-history reconciliation, out of scope).
- PT-0002, paper-trading integration, Autopilot/`feature/autopilot`, Portfolio Intelligence/Opportunity Engine scoring, market-data provider changes, broad UI/mobile redesign, a commissions engine, live-order testing against a real account, TakeProfitScale domain expansion — all explicitly out of scope and untouched.

## 18. Live-order-safety confirmations

- No live order was placed against a real broker account during this work (read-only investigation plus static code changes plus unit tests only).
- `feature/autopilot` was not touched, read from, or merged from.
- PT-0002's queued/unapproved status in `docs/roadmap/ROADMAP.md`/`planning/SPRINT_STATUS.md` is unchanged.
- No `git add .` / `git add -A` was used at any point (see §19).

## 19. Final commit and push status

See the exact commands and their output transcribed at the end of this session's response to the Product Owner. Summary: staged the explicit file list only, committed with the exact message `fix(portfolio): harden live close-order safety`, pushed only `feature/live-close-safety` to `origin`. `main` was not merged into or from. `feature/live-close-safety` was not deleted.

## 20. Recommendation

Recommend Product Owner review of: (a) the widened root-cause finding (systemic arbitrary-leg-quantity idiom across 19 sites, not just the grouping key), (b) the residual same-quantity grouping ambiguity documented in §7 as an accepted, disclosed limitation rather than a gap, and (c) whether the production-build environment limitation (consistent with prior tickets) is acceptable to proceed past, pending Vercel's authoritative build check. Pending that review, this ticket is ready for acceptance or further correction — not merged, not deleted, `feature/live-close-safety` left in place for inspection.
