# CSP-STOP-0001 -- no default stop on CSP entry

Status: built (branch csp-stop-0001). Sponsor: Dean. Ruling: Ian (2026-11-02).

## Defect

The CSP order dialog (`CspTradeModal`, `app/screener/page.tsx`) always sent a bracket order (OTOCO) with a GTC
Stop Limit exit, through `buildCspEntryPayload` -> `buildCreditEntryOtoco`. The stop slider (1.5-4x, default 2x) had
no Off setting. On 2026-10-30 a SOXL Nov 27 55P sold at 2.10 was closed by that stop (trigger 4.20, limit 4.65) at a
loss, although Dean accepts assignment on cash-secured puts (DECIDE-0001; his 2026-10-14 rule: no stop unless he is
not accepting assignment).

## Fix

- `buildCspEntryPayload` takes `stopEnabled` (default false). False sends an OTO: the entry plus one GTC profit
  target (`buildCreditEntryOto`, shared with the covered-call dialog). Only an explicit `true` sends the OTOCO.
- `CspTradeModal`: unchecked opt-in "Close for a loss instead of taking assignment". When off, a note says no stop is
  sent. When on, the existing 1.5-4x slider (default 2x) and trigger/limit show, plus the breakeven (strike minus
  credit) as a stock price that is not an order.
- The normal submit, the dry run and the walk-the-price path all build through `buildCspEntryPayload`, so they cannot
  diverge (the walk previously called `buildCreditEntryOtoco` directly).

## Ian's ruling

Default no stop. The opt-in stop is the 2x-credit option-price stop, not "breakeven on the option price": at entry the
option is worth the credit, so a stop at 1x credit would trigger immediately. Breakeven is a stock price and is shown
as information only.

## Not changed

Spread and iron-condor dialogs (their 2x stop is correct), PMCC, LEAPS, covered calls, Rinse & Repeat, Engine.

## Existing orders

Orders placed through the old dialog still carry their working stop-limit at the broker until cancelled there.

## Tests

`lib/scans/__tests__/cspEntryUnits.test.ts` (default OTO has no Stop Limit; opt-in matches the old OTOCO, including
the 10/30 SOXL case), `app/screener/__tests__/CspTradeModal.test.tsx` (default off, opt-in shows controls and
breakeven).
