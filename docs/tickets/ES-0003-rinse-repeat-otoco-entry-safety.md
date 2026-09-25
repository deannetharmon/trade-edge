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
