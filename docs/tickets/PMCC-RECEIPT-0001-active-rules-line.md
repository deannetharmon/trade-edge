# PMCC-RECEIPT-0001 — Active PMCC rules line: show the rules the scan ran with

## Status

**Scoped by Paul 2026-09-24. Not approved, not built.** Depends on F2 merging (PMCC short delta window becomes a hard filter). Priority: build **before SCAN-GUIDE-0001** (guidance builds on this line) and independent of SCAN-ALIGN-0001C. Part 2 is a separate commit right after F2 merges and can ship on its own if Diane's rendered mock is delayed.

## Problem

F2 makes the PMCC short delta window a hard filter. A delta window persisted from an older scan (`LS_PMCC_DTE`) can silently empty results, with no scan-level indication of which rules were applied. F1's planned receipt row was dropped because no PMCC receipt component exists. Covered calls have `ActiveCcRules.tsx` / `ScanReceiptPanel` driven by `ccRegistry`, and CSP is similar. PMCC has no registry.

## Scope

1. **Active PMCC rules line** (ambient tier), shown with PMCC results after a scan. It shows the rules the scan ran with, read from the scan's **snapshot criteria**, not live controls: DTE range, short delta window (two decimals), max spread % and width ceiling, short OI minimum. Visual weight matches the CC panel.
2. **Interim, own small commit right after F2 merges:** append the delta window to the scan-complete status line, like the earnings-removed suffix.

## Non-goals

A full PMCC registry (owned by the PMCC registry migration ticket, SCREENER-CONFIG-0001B follow-on); editing settings from the line; any advice or guidance (SCAN-GUIDE-0001 owns that); changing any rule. No engine change.

## Acceptance criteria

- The line reflects the scan snapshot. Changing controls after the scan does not change it until the next scan.
- Delta window renders with two decimals (e.g. 0.20–0.35).
- Absent or unset settings degrade gracefully (omit the item or show "—"). No NaN, null or undefined text ever renders (assert `not.toMatch(/NaN|null|undefined/)`).
- Status-line suffix (part 2) shows the delta window from the same snapshot and is omitted when the snapshot has none.
- The line is absent when there is no PMCC scan.

## Implementation notes

Build the line as a small presentational component that takes a plain snapshot object; SCAN-GUIDE-0001's info line can share it, so keep the props generic. No PMCC registry: read from the existing scan snapshot criteria only. Component tests: full, partial and empty snapshot; and a test that changes live controls after the scan and checks the line is unchanged.

## Gates

Diane: a RENDERED mock for Dean (he cannot review ASCII), required before code. Ian: wording only. Alan and Quinn: normal test review only (no scoring or logic change).

## Validation steps

`tsconfig.check.json` tsc, affected tests plus the new component test, real `next build` (page.tsx is touched), Vercel deploy check after merge.

## Rollout notes

Part 1 and part 2 ship as separate, independently revertable commits. Part 2 is not started until F2 is merged.
