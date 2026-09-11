# PMCC-0003A — Package A Correction Order

**Owner:** Paul

**Implementation:** Dane

**Methodology review:** Ian

**UX review:** Diane

**Architecture / QA:** Quinn

**Gate disposition:** Frank

**Status:** Ordered; Package B remains gated

**Target branch:** `feature/pmcc-leaps-ranked-finders`

**Parent ticket:** `docs/tickets/PMCC-0003-qualified-ranked-finders.md`

## 1. Outcome

Correct the contained contract defects found during Package A review, expand
the boundary tests, and return Package A for a second cross-functional gate.

This is not a methodology redesign. Preserve the approved numerical policies,
three-workflow product model, held-LEAPS non-retroactivity, shadow-only status,
and all existing order/account safeguards.

## 2. Authority and scope

Dane is authorized to modify only the dormant Package A contracts, their tests,
and their Package A documentation. No launcher, production scanner, active
cache migration, recommendation surface, trade-review route, order builder,
broker submission, lifecycle, accounting, or user-visible behavior may change.

Package B and Packages C–F remain unauthorized.

## 3. Canonical workflow definitions

Add one typed, immutable workflow-definition map. It must bind each identifier
to its approved product meaning rather than exposing identifiers alone.

| Workflow | Launcher label | Expanded title | Starting foundation | Result kind | Permitted future proposal |
|---|---|---|---|---|---|
| `leaps` | `FIND LEAPS` | `Find LEAPS` | No holding required | Standalone long-call candidates | One BTO long call only |
| `new-pmcc` | `FIND NEW PMCC` | `Find a New PMCC` | No holding required | Complete synchronized long/short pairs | BTO long call plus STO short call as one net-debit proposal |
| `leaps-short-call` | `LEAPS SHORT CALLS` | `Find a Short Call for My LEAPS` | Exact eligible held long call | Short-call candidates bound to that foundation | One STO short call only |

The map is descriptive and dormant. It must not activate a launcher or grant
order authority. Add exhaustive tests for all fields and all three workflows.

## 4. Complete the policy-version registry

Add independently versioned shadow identities for the contracts required by
PMCC-0003 section 6:

- LEAPS qualification
- PMCC pair qualification
- Short-call cadence
- Earnings proximity
- Quote / modeled execution
- Ranking and tie-breaking
- Order revalidation

Existing cushion and held-runway identities remain separately versioned. Names
must be stable, explicit, and stored in V2 envelopes. These are reserved
contract identities only; this order does not implement or activate later
packages' production services.

Changing any policy identity must invalidate an older finder envelope.

## 5. Held-LEAPS semantics

Refactor the LEAPS-window result so it cannot confuse new-entry quality with
held-foundation eligibility.

The result must expose factual observations independently:

- `inputValid`
- `withinSupportedNewEntryBand`
- `withinPrimaryNewEntryBand`
- `withinPreferredNewEntryBand`
- `newEntryGateApplies`
- `newEntryRecommendationEligible`
- A disclosure/reason list

Required behavior:

- For `new`, valid inputs and the approved bands determine recommendation
  eligibility exactly as PMCC-0003 specifies.
- For `held`, `newEntryGateApplies` is false. Out-of-band status is disclosed
  but does not retroactively reject the holding.
- Held acquisition must never force any band fact or recommendation eligibility
  to true.
- Invalid, nonfinite, missing, zero/negative-DTE, or expired held evidence must
  fail closed as invalid evidence. This evaluator must not claim that such a
  contract is an eligible PMCC foundation.
- Overall held-foundation eligibility remains the responsibility of the later
  exact identity, deliverable, quantity, coverage, runway, quote, earnings, and
  short-call gate composition.

Remove or rename the overloaded `supported` and
`primaryRecommendationEligible` fields if retaining them could allow misuse.

## 6. Short-call cadence and Auto bridge

Preserve the approved profiles and global delta boundary.

Resolve 19–24 DTE as follows:

- It is not part of the 7-day, 14-day, or 30–45-day profile.
- It is excluded when the user explicitly selects any of those profiles.
- Auto may classify it as `auto-bridge`.
- An `auto-bridge` candidate may remain qualified only when it passes every
  other mandatory gate and the global 0.10–0.35 delta boundary.
- It receives no cadence-preference bonus and must disclose that it falls
  between standard management cadences.
- Auto ranks bridge candidates within their own bucket and compares the bridge
  winner with the standard cadence winners using the same normalized Auto
  comparison contract. Annualized premium may not dominate the comparison.

Package A implements only this classification contract and its tests. The
actual Auto ranking integration remains in its previously assigned package.

## 7. Earnings evidence and time handling

Refactor earnings evaluation to require an explicit evaluation context:

- Current evaluation/snapshot timestamp
- Maximum permitted evidence age supplied by the calling policy
- Exchange trading-session predicate or calendar adapter

The production-facing evaluator must not silently default to weekday-only
counting. A weekday predicate may remain available only as an explicitly named
test/helper implementation.

Before any evidence can pass:

- `source` must be nonempty.
- `asOf` must be a valid timestamp, must not be in the future relative to the
  evaluation context, and must be within the supplied permitted age.
- Invalid, missing, future, or stale provenance returns `UNAVAILABLE`.
- `UNKNOWN` and `STALE` remain fail-closed.
- `NOT_SCHEDULED` still requires coverage through short expiration plus ten
  exchange sessions.
- Pending/estimated evidence still requires a valid bounded range, uses the
  earliest date, and returns `UNAVAILABLE` when it may overlap the short-call
  life or required buffer.

For confirmed earnings, count completed exchange sessions between option
expiration and the event timestamp:

- `before-market`: do not count the event-date session.
- `after-market`: count the event-date session when it is an exchange session.
- `unknown`: use the conservative before-market treatment.

Then apply the approved boundaries: fewer than 5 fail, 5–9 caution, and 10 or
more pass. Same-day cases remain failures because they have no five-session
buffer, regardless of event time.

The acquisition cascade and submission-time refresh remain later integration
work; do not perform internet lookup or select a paid provider in this order.

## 8. Ranking and deterministic comparison

Preserve the approved 30/20/15/15/10/10 weights.

Required corrections:

- Retain an unrounded canonical total for ordering.
- Expose a separately rounded display total if needed.
- Never let rounded display equality invoke tie-breakers for unequal canonical
  scores.
- Excluded, incomplete, unavailable, or unqualified candidates are not
  rankable. A comparator must reject them by type/API design or return no
  relative ranking; it must not run the tie-break ladder on them.
- `modeledSlippage` is nullable/unavailable because no approved model exists.
  Do not synthesize zero or another favorable value.
- At the slippage tie-break stage, compare it only when both candidates have a
  valid value; otherwise skip that stage for the pair and continue
  deterministically.
- Preserve the approved remaining order: greater cushion, better worst-leg
  liquidity, lower modeled slippage when mutually available, lower LEAPS
  extrinsic burden, lower capital, then stable OCC order.

Expose component scores and incomplete dimensions as before.

## 9. Workflow-specific V2 cache payload contracts

Keep the three distinct V2 cache keys. Replace envelope-only acceptance with a
typed workflow-specific payload contract.

At minimum, every payload must contain immutable discriminants for:

- Its exact workflow identity
- Its result kind
- Its snapshot identity/as-of value
- Its policy-version set
- A results collection

Validation must reject:

- Null, primitive, array, missing, or malformed payloads
- A payload whose workflow differs from its envelope
- A result kind belonging to another workflow
- Missing or mismatched policy versions
- Invalid snapshot timestamps/identity
- A cross-workflow payload that is otherwise structurally similar
- The ambiguous legacy `requestedStrategy: 'pmcc'` record

The schemas may use minimal result records in Package A; full result payloads
arrive with their owning later packages. Do not activate persistence or migrate
real user caches in this order.

## 10. Required tests

Add or revise tests for all of the following:

### Workflows and versions

- Every workflow-definition field and permitted proposal shape
- Every required policy-version identity
- Policy mismatch invalidation

### LEAPS

- All existing PMCC-0003 delta/DTE boundaries
- Out-of-band held contract retains false band facts without a new-entry gate
- Invalid, NaN, infinite, zero/negative-DTE, and expired held inputs fail closed

### Cadence

- Each DTE endpoint and immediately outside each endpoint
- Immediately below, equal to, and above every preferred-delta endpoint
- Global delta boundary below/equal/above 0.10 and 0.35
- Auto bridge at 19 and 24 DTE
- Bridge excluded from each explicit profile

### Cushion and runway

- Zero cushion
- One-cent positive cushion
- Immediately below, equal to, and above the $1 floor
- Immediately below, equal to, and above the 3% floor
- Runway 29/30/89/90 and invalid inputs

### Earnings

- Confirmed 4/5/9/10-session boundaries
- Before-market, after-market, and unknown event time at boundary dates
- An exchange holiday near a boundary
- Pending valid, invalid, reversed, and overlapping ranges
- Unknown, stale, not-applicable, and not-scheduled with sufficient/insufficient
  coverage
- Empty source and missing, invalid, future, and expired `asOf`
- Missing evaluation context/calendar fails closed

### Ranking

- Weight total and component exposure
- Incomplete/unqualified candidates cannot be ordered
- Unequal canonical scores that round to the same display value
- Every tie-break stage independently
- Null slippage on one and both candidates
- Stable OCC final ordering

### Cache

- All three valid workflow payloads
- Wrong-workflow envelope and payload combinations
- Wrong result kind
- Malformed/null/array payloads
- Legacy `pmcc` rejection
- Timestamp and policy-version mismatch

## 11. Validation and implementation report

Dane must run and report:

1. Corrected Package A test suites with exact counts.
2. Existing targeted PMCC/LEAPS regression suites.
3. `npx tsc --noEmit`.
4. Full `npm test` with exact pass/fail totals.
5. `npm run build`.
6. `git diff --check`.
7. A production-import search confirming the corrected modules remain dormant.

Update the Package A implementation report and data-availability report where
their prior claims changed. Do not describe an envelope-only check as payload
validation. Record any remaining baseline failures without fixing unrelated
behavior.

Return:

- Files changed
- Contract changes and reasons
- Exact test/build results
- Remaining limitations and deferred integrations
- Confirmation that no production consumer, launcher, cache migration, or order
  path changed
- A specific request for Ian, Diane, Quinn, Paul, and Frank to re-review

## 12. Acceptance gate

Package A closes only when:

- Ian confirms the earnings, cadence, LEAPS, cushion, and ranking methodology.
- Diane confirms the workflow map and held-LEAPS language cannot mislead the
  future UX.
- Quinn confirms workflow-specific payload rejection, type safety, policy
  reproducibility, determinism, and boundary coverage.
- Paul confirms this correction stayed inside Package A.
- Frank records `OPEN PACKAGE B`.

Until all five decisions are recorded, Package B remains closed. Packages C–F
remain gated even if Package B later opens.

## 13. Stop conditions

Stop and return to Paul before implementation only if correction requires:

- A new user-visible workflow or name
- A different numerical qualification boundary or ranking weight
- A paid/new data provider decision
- A production cache migration
- Any change to account, coverage, order-leg, lifecycle, accounting, or broker
  authority
- Any user-visible activation

Ordinary type names, module placement, validation mechanics, and test fixtures
are delegated to Dane.

## 14. Paul disposition

The review produced enough information to execute this correction order. The
remaining choices are bounded engineering details or are resolved above. No
additional decision is required from Dean before Dane begins.
