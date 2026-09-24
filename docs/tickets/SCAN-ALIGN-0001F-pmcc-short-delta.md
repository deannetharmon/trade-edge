# SCAN-ALIGN-0001F — PMCC short-delta: control polish (F1) and rule flip (F2)

## Status

**F1 accepted by Dean 2026-09-24. F2: direction accepted (PMCC delta becomes a hard filter), held until after F1; Dean revisits timing then. Not built.** F1 is build order slot 8 and needs mock 1 approved (Diane). F2 needs mock 3, LEAPS-ADVISOR-0001B built or re-scoped, and Dean's timing decision.

## Problem

Covered call treats delta as a hard limit; PMCC treats it as a preference and keeps out-of-window shorts with a warning (`NEW_SHORT_DELTA`), which overrides the trader's window.

## Scope

**F1 (PMCC delta control polish):** the control already exists (`shortDeltaMin`/`shortDeltaMax`, "Min Δ"/"Max Δ", 0.10–0.40). Add preset chips, hint text and a receipt row. Ships before or with F2, never after.

**F2 (deferred rule flip):** remove `role !== 'short'` (`pmccPairing.ts:162`); bounds inclusive; `NEW_SHORT_DELTA` becomes unreachable (remove or mark defensive); the "Delta guides rank" note goes. Held mode can end with zero shorts, so the empty-result banner (mock 3) must name the binding filter, with an "Adjust short delta" action.

## Non-goals

- Bundling F2 with any other engine flip. F2 gets its own revertable test flip.

## Acceptance criteria (F2, Alan)

- |delta| = min and = max pass; negative delta via `abs`; null rejects. `pmccStartPrice`'s delta-cap assumption becomes true.

## Notes

If F2 is still held at the PMCC registry migration, the registry records delta as a deliberate difference (CC hard, PMCC preference). `PMCC-HELD-LONG-FLAGGED-0001` shares mock 3 and is approved after F1.
