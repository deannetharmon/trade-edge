# CSP-IVR-0001 — Missing IVR must not pass the CSP cap

## Status

**Draft.** Ian recommends; needs Dean's approval. Engine-policy change, separate from `SCREENER-CONFIG-0001A`.

## Problem

CSP is undefined-risk. `lib/scans/cspIvrPolicy.ts` (moved unchanged out of `app/screener/page.tsx` in SCREENER-CONFIG-0001A) disqualifies a symbol above the IVR cap (`DISQUALIFIED_IVR`), but when IVR is unavailable it returns a warning ("Not available") and the symbol passes. The current behavior is pinned by a test in `lib/scans/__tests__/cspConfigTruthfulness.test.ts`; that test changes with this ticket. The cap cannot be verified, yet the candidate proceeds.

## Proposed behavior

When IVR is unavailable, the cap check fails closed. Decision needed: is such a symbol a visible near-miss with an explicit reason, or omitted from results? Recommendation: visible, so the trader sees why.

## Also required

- Update the registry copy and the result receipt (currently states the gap).
- Alan: fixture pinning the new behavior; before/after scan counts attributable to this change.
- Ian: confirm the same treatment for other undefined-risk strategies, if any.
