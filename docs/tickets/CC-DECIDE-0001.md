# CC-DECIDE-0001 -- covered call: what to do, and the catch (slice A)

Dean (2026-11-09): the covered-call screen shows a premium but not the trade-off. Mock approved by Ian, Diane, Paul (project board
"Covered call decision view").

## Slice A (built)
- `lib/scans/ccDecide.ts` (pure): "Sell N $K calls expiring <date> for $X." plus "You keep all gains up to $K. Model odds: about a P%
  chance you keep your shares." (P = 1 - |delta|). "The catch": a typical move up for the call's days (expiration IVx expected move,
  model estimate) and the gain you would miss, with the sale result including the credit collected. A strike below your cost is
  stated as a loss in dollars, before the credit. No IV: the rally figure is left out. No cost basis: the sale result is left out.
- `features/screener/components/CcDecideBoxes.tsx`: the two boxes, at the top of the qualified covered-call card's details.
- Display only. The existing premium / contracts / cost-basis row and details are unchanged.

## Not in slice A
"Try a different price" (B), "Pick a different call" (C), "More income or more upside" (D). No link ships before its view exists.
"Don't sell a call right now": the covered-call scan has no minimum-credit setting, and a ticker with no valid call already shows the
one-line reason (CC-SIMPLIFY ccBrief), so there is nothing to add here yet.
