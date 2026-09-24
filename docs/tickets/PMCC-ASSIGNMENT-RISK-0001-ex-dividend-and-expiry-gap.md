# PMCC-ASSIGNMENT-RISK-0001 — Ex-dividend early-assignment risk and short-to-LEAP expiry gap

## Status

**Draft, from the `SCAN-ALIGN-0001` second review (Ian, 2026-09-24). Not approved, not built.** Needs Paul scope. Data-source decision needed for ex-dividend dates.

## Problem

1. **Ex-dividend.** An ITM short call near ex-dividend with less extrinsic than the dividend carries early-assignment risk. For PMCC, assignment forces a LEAP exercise or sale, so exposure is higher than for a covered call.
2. **Expiry gap.** Nothing confirms the short expires well inside the LEAP with a minimum gap. To be verified in `pmccPairing.ts` before scoping.

## Scope (proposed)

- Verify what the pairing code enforces for the expiry gap; add a minimum if absent.
- Add an ex-dividend warning (risk-context tier, not an exclusion) when extrinsic < dividend and ex-date falls before short expiry.

## Non-goals

- Applying the same check to covered calls (separate decision).

## Open questions

- Ex-dividend data source and freshness.
- Minimum expiry gap (Ian).
