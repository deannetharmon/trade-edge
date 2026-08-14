# SR-0001 — Shared Results Sorting

**Status:** Runtime scope approved for inclusion in the uncommitted WA-0005 corrective review; unaccepted and unmerged
**Scope boundary:** Product/architecture explicitly authorized the existing SR-0001 runtime implementation to remain in this corrective round.

## User outcome

Every `/screener` scan-results view provides the same **Sort by** control:

- Rank
- OI
- CR
- Cap Required
- OTM

An adjacent direction toggle supports ascending and descending order.

## Acceptance contract

- Default ordering is Rank ascending (best published rank first).
- Selecting OI, CR, or OTM initially uses descending order.
- Selecting Cap Required initially uses ascending order.
- The direction toggle may reverse the selected metric.
- OI is the weakest required option-leg open interest.
- CR is the candidate's canonical numeric `creditRatio`.
- Cap Required reads only canonical candidate risk/capital fields:
  `expectedOutcome.capitalRequired` / `candidate.theoreticalMaxLoss` for
  recommendation publications and producer-retained `capitalRequired` for raw
  scan publications. Sorting performs no financial calculation.
- OTM uses the canonical unformatted distance calculation and the tighter side
  for an iron condor.
- Missing numeric values sort last in both directions.
- Filtering occurs first, sorting second, and the 10/20/50/All display limit
  last.
- Client-side sorting acts immediately on already-published results and never
  starts or repeats a scan or recommendation evaluation.
- Original published rank numbers remain attached to their results when another
  metric changes presentation order.
- The control and semantics are shared across Ranked Opportunities, Targeted
  results, Filter results (including strategy-filtered subsets), and Ranked
  raw results.

## Implementation boundary

The shared pure sorting contract lives with the existing canonical
result-presentation helpers. `/screener` supplies each view's original
publication rank and retained `ScreenResult`; the sorter returns a stable
presentation copy and does not mutate, rescore, renumber, persist, or
re-evaluate the source population.

## Validation ownership

Pure tests own metric extraction, direction, stable rank handling, missing-last
semantics, and sort-before-limit behavior. Mounted `/screener` coverage owns
control availability, defaults, and the guarantee that changing sort controls
does not call the recommendation endpoint.
