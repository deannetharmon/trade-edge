# Adding a New Strategy — Checklist

Companion to `STRATEGY-DEFS-0001`. `SpreadCandidate.strategy` is now the
canonical `SpreadStrategy` union (`lib/scans/types.ts`) — adding a new
strategy value there will make `tsc --noEmit` surface many of the places
below automatically, via exhaustiveness checks on `switch` statements
already using the `_exhaustive: never` pattern. This checklist exists
because not every location is (or needs to be) an exhaustive switch —
some are `if` chains, and TypeScript can't catch an `if` chain silently
falling through to a wrong default the way it can a `switch`.

Known places a new strategy needs a case, confirmed by tracing the four
gaps found the week `PMCC` was added:

1. **Order-leg building and payload framing** — `lib/scans/orderBuilder.ts`
   (`buildOrderLegs`, `buildOrderPayload`, `hasOccSymbolsForOrder`). Does
   the new strategy need multi-expiration legs? Debit or credit framing?
2. **OTM-distance formula** — `calcOtmPct` in `lib/scans/rank-scoring.ts`.
   Which direction is "safely OTM" for this strategy's short leg(s)?
3. **Relevant-leg OI definition** — `getLegOiSet` and
   `extractOiLegsFromSpreadCandidate` in
   `lib/screener/screenerResultOrdering.ts`. Which leg(s) are *required*
   to clear the OI floor, and which (if any) are merely *protective*
   (warned about, never blocking)? Get this wrong and a strategy either
   fails candidates that shouldn't fail, or passes ones that shouldn't
   pass.
4. **Filtered-mode result-controls** — does this strategy get its own
   dedicated single-strategy session (like CSP/CC/PMCC), or does it join
   the general multi-strategy toggle row (like BPS/BCS/IC via "Find
   Spreads")? If dedicated, use `SingleStrategyResultControls`
   (`app/screener/page.tsx`) rather than writing another near-duplicate
   block.
5. **Autopilot / `AutopilotStrategy`** — does this strategy have
   canonical representation there yet? If not, does
   `lib/autopilot/decision/screenerCandidateAdapter.ts` correctly exclude
   it with a clear reason (matching the existing PMCC exclusion), rather
   than silently mishandling it?
6. **Result-card display** — does the strategy need its own labeled
   summary fields (like PMCC's `Net Debit`/`Short Credit`/`Extrin.`/`Max
   P`), or does it fit the generic credit-spread framing?

This list is not exhaustive by construction — it's the set of places
already known to matter, updated whenever a new gap of this shape is
found. If you find another one, add it here.
