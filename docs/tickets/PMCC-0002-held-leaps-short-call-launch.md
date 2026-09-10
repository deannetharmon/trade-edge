# PMCC-0002 — Held LEAPS Short-Call Launch

## Outcome

From Portfolio, a verified and available held LEAPS can launch the existing
Screener PMCC flow for that exact broker contract. The Screener then evaluates
only potential short calls; it does not buy another long call or submit an
order automatically.

## Launch gate

Portfolio exposes **Find short call** only when all of the following are true:

- broker snapshot is current and attributable;
- the position is an unambiguous, single-leg long call in the active account;
- the OCC contract identity is present;
- the long call has 180–730 DTE (the existing PMCC-long policy); and
- no open or working short call matches the held LEAPS as a nearer-dated,
  higher-strike call.

Open positions already carry the broker-position pairing derived from the
same underlying, a shorter DTE, and a higher short-call strike. Working orders
use that same visible contract shape. An unrelated short call no longer blocks
the LEAPS merely because it shares an underlying.

## Handoff

Portfolio stores account number, position key, underlying, and exact OCC symbol
in one-time session storage, then opens `/screener?launch=pmcc-held`.
The Screener refreshes broker holdings and accepts the launch only if every
identity field still matches. The PMCC scan uses that single held contract as
its long leg.

## UI

- Portfolio status: **Ready — find short call**.
- Ineligible states show the specific reason and do not provide a launch
  action.
- The former static Review banner is removed.
- Screener’s normal PMCC settings modal opens with the verified held LEAPS as
  its sole selection.

## Non-goals

- No automatic order submission.
- No new-long-leg PMCC entry from this launch.
- No per-LEAPS allocation model for multiple long calls on one underlying.
- No conversion of a proposed short call into a submit-capable ticket. That
  requires a separate server-side covered-short-call order gate.

## Acceptance checks

- A stale, ambiguous, wrong-account, out-of-range, or short-call-occupied
  LEAPS cannot launch the Screener flow.
- A valid handoff cannot fall back to another LEAPS with the same ticker.
- A changed/closed held contract is rejected after the Screener refresh.
- Standard **Find PMCCs** behavior remains unchanged.
