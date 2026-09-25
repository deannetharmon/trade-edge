# ES-0003 — Rinse & Repeat OTOCO Entry Safety

**Status:** Implemented pending review and validation.

## Problem

`app/rinse-repeat/page.tsx` submitted a new live OTOCO entry directly after
inline UI checks. It had no dedicated, mock-testable broker boundary, so a
future change could send a malformed order without passing an execution gate.

## Scope

- Validate whole-contract quantity, exact non-duplicated OCC leg identities,
  opening actions, and per-leg quantity parity.
- Validate positive whole-cent prices, a profit target below entry credit, and
  a stop trigger above entry credit.
- Build the exact OTOCO payload in a pure module; do not accept a separately
  constructed broker body.
- Invoke `ttPostComplex` only inside the gate's callback and test that blocked
  inputs never reach a broker mock.

## Non-goals

- No new strategy qualification, quote freshness policy, account-capacity
  model, order replacement flow, or PortfolioMode surface decision.
- No change to the existing OTOCO order shape or its atomic entry/bracket
  behavior.

## Acceptance criteria

1. The only Rinse & Repeat live OTOCO broker call is inside
   `submitRinseRepeatOtocoIfSafe`'s callback.
2. Invalid price relationships, fractional-cent prices, incomplete/duplicate
   legs, and quantity mismatch fail closed before broker submission.
3. Closing actions are derived as exact inverses of validated opening actions.
4. Focused tests prove both valid payload construction and no broker call for
   each blocking condition.


## Ian's ruling 2026-09-25: the multi-leg `Stop` child is REJECTED as written (proof first)

The OTOCO stop child is `'order-type': 'Stop'` (stop-market) on multi-leg closing legs (`lib/rinse-repeat/otocoEntrySafety.ts:114`), and it omits `'price-effect'`. CLAUDE.md: stop-market is unsupported on multi-leg positions and multi-leg orders need a Limit ($0.01 floor). The repo cannot prove how TastyTrade handles it; the test only asserts the shape we built. Every other stop in the repo is Stop Limit (`lib/screener/entryBracket.ts:54`, `app/portfolio/page.tsx` 6316/6907/6962/7003) with `price-effect: Debit`. This ticket's "no change to the existing OTOCO order shape" carried the shape over unvalidated. Best case the broker rejects it; worse, it is accepted and behaves unexpectedly, leaving a possibly unprotected position after entry.

**Do not run Rinse & Repeat live until step 1 of the proof is answered.**

Required stop child shape: `{ 'order-type': 'Stop Limit', 'time-in-force': 'GTC', 'stop-trigger': '<2x credit>', price: '<trigger x 1.10, cents>', 'price-effect': 'Debit', legs: closingLegs }` (entry stays Limit/GTC/Credit, profit target Limit/GTC/Debit). The guard should require a positive whole-cent `stopLimit >= trigger`, above the entry credit, capped at spread width minus entry credit (so the 1.10 buffer cannot exceed max loss).

**Proof (Dean, browser-side broker calls; save responses under `docs/reviews`):** (1) one OTOCO dry-run/cert/paper order for a 2-leg credit spread with the CURRENT `Stop` child: record the exact accept/reject response and resulting order status/type; (2) the same with the Stop Limit shape: confirm accepted, children `Contingent`, trigger and limit preserved; (3) repeat on a 4-leg iron condor. **Then a small ticket:** shared builder (reuse or extend `buildCreditEntryOtoco`), required `stopLimit` on the guard, tests that a missing `stopLimit` or a limit below the trigger fails closed, Quinn confirms the max-loss cap test. No live-order code change until the proof is done.
