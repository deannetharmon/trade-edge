# PMCC Held-LEAPS Candidate Workflow — Implementation Proposal

**Status:** Proposed — approval requested from Ian and Quinn  
**Scope:** PMCC discovery and review only; no automated order submission

## Decision requested

Approve a PMCC workflow that recognizes eligible long calls already held in the
connected Tastytrade portfolio as candidate long legs. The scanner should then
look for a new short call to sell against that exact held contract.

A held long call is not itself a completed PMCC. It becomes a PMCC candidate
when the scanner can validate a compatible short call. The held-contract path
must never propose buying the long call again.

## Current behavior and gap

The existing PMCC scan constructs both legs from the option chain for symbols
in the Opportunity Universe. It does not read `PortfolioSnapshot.options` as a
source of long-leg candidates. Consequently, an existing LEAPS position can be
omitted even when it is a suitable long leg for a covered short call.

The current new-position ticket intentionally produces two opening legs: **Buy
to Open** long call and **Sell to Open** short call. That ticket is not safe for
a held-LEAPS result and will not be reused for this feature.

## Proposed behavior

1. Read the current, account-scoped portfolio snapshot during a PMCC scan.
2. Select initially only unambiguous, single-leg, long equity calls. Multi-leg
   positions, adjusted deliverables, missing contract identities, and stale or
   unavailable portfolio snapshots are excluded with a visible reason.
3. Add the underlying symbols for these held candidates to the PMCC scan scope,
   even if they are absent from the Opportunity Universe.
4. Fetch a fresh option chain and match the held contract exactly by OCC symbol
   and contract identity (underlying, call type, expiry, and strike). Never
   substitute a nearby contract or manufacture Greeks, open interest, or quotes.
5. Run the established PMCC pairing checks against fresh eligible short calls.
   Results are labelled **Held LEAPS — propose short call only**.
6. Preserve existing new-PMCC results and ranking. A result records whether its
   long leg is new or held, so the UI and downstream review flow cannot confuse
   the two cases.

## Safety boundaries

- Phase 1 is review-only: no broker order action is exposed for held-LEAPS
  results. It may show the proposed short call and supporting evidence.
- A later, separately approved execution phase may add a short-call-only ticket
  with account ownership and quantity checks. It must emit only **Sell to Open**
  for the short call; it cannot use the existing two-leg entry ticket.
- A long call is eligible only when it is present in the current account
  snapshot. Symbol-only matching is not sufficient.
- If the held contract cannot be matched in the live chain, it is excluded; the
  system does not infer an equivalent replacement.
- Existing suitability, deterministic action, and no-auto-submit safeguards are
  unchanged.

## Recommended implementation shape

Add a small, pure held-candidate selector/matcher (for example,
`lib/scans/pmccHeldLeaps.ts`) and extend PMCC result metadata with:

```ts
entryMode: 'new-pmcc' | 'covered-short-call-against-held-leaps'
heldLongLeg: boolean
```

The PMCC production path receives the exact matched held long legs as an
explicit candidate input while continuing to source short-leg pricing and
validation data from the live option chain. Likely touched areas are:

- `app/screener/page.tsx`
- `lib/scans/pmccProduction.ts`
- `lib/scans/pmccTypes.ts`
- `lib/scans/pmccChainAdapter.ts` (if matching support belongs there)
- New focused held-LEAPS selection/matching tests

## Eligibility policy proposed for approval

For the first delivery, treat these as **held long-call candidates**, rather
than assuming every long call is a LEAPS:

- long call, standard deliverable, one unambiguous option position;
- exact broker contract identity available;
- position belongs to the active account and snapshot is current;
- existing PMCC long DTE and delta criteria continue to apply;
- live quote quality is required before a recommendation is marked ready.

Recommendation: do **not** apply the new-long-entry open-interest minimum to a
contract already owned. Its liquidity remains visible as evidence, but should
not silently disqualify a held contract solely because it is no longer an entry
candidate. Ian and Quinn should explicitly approve or change this policy.

## Acceptance tests

1. One held long call with an exact live-chain match yields short-call pair
   candidates and is marked as held.
2. Two held LEAPS under the same or different symbols remain distinct;
   quantities and identities are not merged.
3. With no usable portfolio snapshot, generic PMCC scanning behaves unchanged.
4. A missing or mismatched live contract produces an exclusion reason and no
   substituted long leg.
5. Multi-leg, adjusted, stale, or incomplete holdings cannot enter the held
   candidate path.
6. A held-LEAPS result cannot produce a **Buy to Open** long-leg action.
7. New-PMCC results retain the present two-leg review behavior.
8. The scanner fetches broker market data through the authenticated same-origin
   server proxy, not directly from the browser.

## Separate completed repair: PMCC “Failed to fetch”

The reported fetch error is independent of the held-LEAPS feature. The scanner
was making broker market-data requests directly from the browser, where they
can fail due to cross-origin/network enforcement. A small local repair changes
`lib/scans/tastytrade-client.ts` to use the already authenticated server proxy.
Targeted PMCC tests and TypeScript compilation pass. It should be reviewed and
deployed as a separate commit so it is easy to diagnose and roll back.

## Approval questions

1. Approve the phase-1 review-only boundary, with no short-call order ticket.
2. Approve limiting the first release to unambiguous single-leg long calls.
3. Approve reusing the configured PMCC DTE/delta rules while exempting held
   long calls from the *entry* open-interest minimum.
4. Approve surfacing held candidates outside the Opportunity Universe, labelled
   clearly as portfolio-derived.

Once approved, implementation will be delivered with the acceptance tests
above and a separate deployment commit for the browser-to-server fetch repair.

## Implementation update — 2026-08-27

**Disposition:** Implemented as the approved phase-1, review-only workflow;
awaiting Dean's review and deployment.

- `lib/scans/pmccHeldLeaps.ts` now selects only current, active-account,
  unambiguous, single-leg long calls and records exclusion reasons.
- Held contracts are matched to the live chain by OCC identity, underlying,
  call type, expiration, and strike. An unmatched held contract produces an
  audit result; it cannot fall back to a new-long PMCC candidate.
- Held pairs are marked `covered-short-call-against-held-leaps`, include the
  attributable account/position/quantity metadata, and bypass the new-entry
  long open-interest floor only. Their DTE, delta, quote, and short-leg
  requirements remain enforced.
- The PMCC card identifies the long call as **HELD**, discloses the exact
  contract and proposed short-call quote/economics, and renders a review-only
  notice instead of a trade button.
- The existing PMCC two-leg ticket has a defensive runtime guard that rejects
  a held-LEAPS result even if it were invoked outside the normal UI path.
- Persisted scan-session validation verifies the held-contract binding and
  rejects a modified contract identity.

Validation completed:

```text
npx vitest run lib/scans/__tests__/pmccHeldLeaps.test.ts lib/scans/__tests__/pmccProduction.test.ts
# 19 tests passed
npx tsc --noEmit --incremental false
git diff --check
```

The browser-to-server Tastytrade scanner fetch repair remains a separate,
small commit as proposed.
