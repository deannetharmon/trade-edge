# LEAPS Position Intelligence System — Product and Design Specification v1

**Status:** Draft for Paul, Ian, Diane, Alan, Quinn, and Dane review  
**Product owner:** Paul  
**Decision-policy owner:** Ian  
**Design owner:** Diane  
**Implementation owner:** Dane  
**Scope:** Broker-held standalone long calls / LEAPS and their optional PMCC income cycles

## 1. Product decision

TradeEdge will manage a held LEAPS as one **position intelligence system**.
It will not treat the long call, a possible PMCC short call, the LEAPS scanner,
and the Portfolio recommendation as separate systems with separate scores.

The system's job is not to predict the market or declare a universally “best”
trade. Its job is to recommend the next **review state** from fresh broker and
market evidence, the trader's saved mandate, and explicit policy rules:

1. **Hold uncovered** — preserve the long call's upside exposure.
2. **Review income call** — inspect a particular qualified short-call candidate.
3. **Monitor** — wait for a named condition to change.
4. **Reassess thesis** — review the long LEAPS itself.
5. **Not ready / Market closed** — do not infer a decision from incomplete,
   stale, mismatched, or unavailable evidence.

No state submits, rolls, closes, or exercises an order. A state opens a
review flow only after the trader chooses it.

## 2. Why this exists

A long call has two competing but legitimate uses:

- It is a directional, long-horizon exposure with valuable upside convexity.
- It can support a later short call to generate income, at the cost of capping
  some of that upside while the short call is open.

“Sell a call every 30 days” is not sufficient policy. It can sell valuable
upside during a catalyst or when the option premium does not compensate for
the cap. Conversely, never selling calls can ignore attractive short-term
carry when the trader's outlook is neutral to moderately bullish.

The product must make that tradeoff explicit and auditable.

## 3. Product principles and non-negotiable boundaries

1. **One canonical decision object.** Portfolio, LEAPS results, PMCC review,
   alerts, and history consume the same calculated object. They do not
   recalculate eligibility independently.
2. **Broker facts first.** A live, exact broker-held OCC long-call identity is
   required before a PMCC action is enabled.
3. **Policy is visible and versioned.** A trader can see the active thresholds,
   evidence, rule version, and why a state was selected.
4. **A score is not a command.** Scores rank or summarize evidence; rules and
   the trader's mandate determine whether an action is reviewable.
5. **Fail closed.** Missing account identity, contract data, freshness,
   deliverable compatibility, quote quality, or capacity cannot generate a
   positive action.
6. **PMCC is not a stock covered call.** It has separate foundation,
   assignment, and management behavior. Conventional stock covered-call
   behavior remains separate and unchanged.
7. **No fake precision.** Forecast, expected move, IV, and thesis evidence are
   inputs and uncertainty indicators—not promises of return or probability.
8. **Human decision required.** The product may route to review; broker order
   review and submission remain explicit user actions.

## 4. User outcomes

For each broker-held LEAPS, a trader can answer in under one minute:

- What did I pay, what can I realistically exit for now, and what is the
  expiration break-even?
- Is the long-call thesis still healthy, weakened, or invalidated?
- Is retaining upside more valuable than selling an income call right now?
- If I sell the proposed income call, exactly what credit, upside cap, and
  remaining exposure am I accepting?
- What must happen before I review this position again?
- What did I decide last time, from what evidence, and what happened after?

## 5. Canonical domain model

### 5.1 `LeapsPositionIntelligence`

The system calculates and persists a versioned decision snapshot for each
exact broker-held long-call position. It does not replace broker transactions,
positions, or P/L records.

```ts
type LeapsPositionIntelligence = {
  identity: {
    accountNumber: string;
    positionKey: string;
    underlying: string;
    longOccSymbol: string;
    contractCount: number;
    asOf: string;
    brokerSnapshotId: string;
  };
  longCall: {
    expiration: string;
    dte: number;
    strike: number;
    entryDebitPerShare: number | null;
    entryDebitTotal: number | null;
    bid: number | null;
    ask: number | null;
    mid: number | null;
    executableExitValue: number | null;
    unrealizedPnl: number | null;
    expirationBreakeven: number | null;
    exitToWashGap: number | null;
    intrinsicValue: number | null;
    extrinsicValue: number | null;
    delta: number | null;
    iv: number | null;
    quoteQuality: QuoteQuality;
  };
  mandate: LeapsMandate | null;
  thesisHealth: ThesisHealth;
  marketContext: LeapsMarketContext;
  pmcc: PmccIncomeReadiness;
  portfolioContext: LeapsPortfolioContext;
  decision: LeapsDecision;
  ledger: { latestDecisionId: string | null; nextReviewAt: string | null };
  policy: { version: string; evaluatedAt: string; freshness: Freshness };
};
```

### 5.2 Trader-owned `LeapsMandate`

The mandate is intentionally small. It captures the trader's decision
boundary without pretending to turn an investment thesis into a forecast.

```ts
type LeapsMandate = {
  thesisSummary: string;
  horizonEnd: string | null;
  thesisTargetLow: number | null;
  thesisTargetHigh: number | null;
  invalidationPrice: number | null;
  posture: 'upside-first' | 'balanced' | 'income-first';
  incomeCapStrike: number | null;
  allowEarningsCycle: boolean;
  preferredShortDte: { min: number; max: number };
  preferredShortDelta: { min: number; max: number };
  minimumCycleCredit: number | null;
  notes: string | null;
  updatedAt: string;
};
```

Rules:

- The mandate is never inferred from a short-term price move.
- `incomeCapStrike` is the lowest short-call strike the trader accepts for a
  new cycle. A candidate below it cannot be a Review state.
- Missing mandate values do not block position-health reporting. They limit
  recommendation precision and may produce `Monitor: preference-not-met`.
- Changing a mandate creates a ledger event; it does not rewrite old decisions.

### 5.3 `ThesisHealth`

Thesis health is an explainable assessment, not a price-target forecast.

```ts
type ThesisHealth = {
  state: 'healthy' | 'needs-review' | 'invalidated' | 'insufficient-evidence';
  primaryReason: string;
  supportingEvidence: EvidenceItem[];
  whatWouldChange: Trigger[];
};
```

Initial v1 rules may use only saved mandate boundaries, long-call DTE, and
data quality. Narrative or AI analysis may summarize evidence, but it cannot
silently override deterministic risk/identity gates. Future fundamental,
technical, or analyst inputs must be labeled with source and freshness.

### 5.4 `PmccIncomeReadiness`

This extends—not duplicates—the existing held-LEAPS PMCC evaluator.

```ts
type PmccIncomeReadiness = {
  foundation: FoundationEvidence;
  activeCycle: ActiveShortCallCycle | null;
  candidate: PmccShortCandidate | null;
  economics: {
    creditTotal: number | null;
    creditAsPctOfLeapsCapital: number | null;
    upsideCapStrike: number | null;
    upsideSurrenderToTarget: number | null;
    netDeltaAfterShort: number | null;
    bidAskCost: number | null;
  };
  state: 'eligible' | 'monitor' | 'not-ready' | 'market-closed';
  monitorReason?:
    | 'no-qualifying-short-call'
    | 'quote-quality'
    | 'capacity-reserved'
    | 'preference-not-met'
    | 'event-window'
    | 'event-data-unavailable';
  evidence: EvidenceItem[];
};
```

The existing PMCC pairing invariants remain mandatory:

- exact broker-held long call;
- same underlying and compatible deliverable;
- long expiration later than the short expiration;
- long strike lower than the short strike;
- unreserved foundation capacity;
- fresh broker and market evidence;
- configured liquidity and quote-quality rules.

### 5.5 `LeapsPortfolioContext`

Portfolio context prevents individually plausible recommendations from
collectively producing excessive concentration.

```ts
type LeapsPortfolioContext = {
  capitalAtRisk: number | null;
  accountAllocationPct: number | null;
  underlyingConcentrationPct: number | null;
  sectorOrThemeConcentration: ConcentrationEvidence[];
  netPortfolioDeltaContribution: number | null;
  correlationGroupExposure: ConcentrationEvidence[];
  warnings: EvidenceItem[];
};
```

v1 aggregates only unique normalized `Position.key` records plus equity
holdings, with explicit gross/net semantics. It must label unavailable
correlation, sector, and thematic data as unavailable—not as low risk—and
must not double-count legs from a PMCC or other multi-leg position.

## 6. Decision policy

The policy is a deterministic waterfall with visible inputs. It is evaluated
on demand, on Portfolio refresh, and after relevant broker/market events.

### 6.1 Decision order

1. **Evidence validity**
   - Missing/stale broker snapshot, account mismatch, ambiguous structure, or
     missing exact long OCC identity → `Not ready`.
   - Market session closed → `Market closed`; retain the last decision as
     history but do not present it as actionable.
2. **Long-call health**
   - Mandate invalidation breached, insufficient remaining DTE, or thesis
     review trigger → `Reassess thesis`.
3. **Existing-cycle protection**
   - Open or working short call using the foundation → `Monitor:
     capacity-reserved`; never offer a second short call.
4. **Event and mandate protection**
   - Earnings/catalyst falls in the proposed short-call life and the mandate
     disallows event cycles → `Monitor: event-window`.
   - Candidate is below the income-cap strike or violates selected DTE/delta
     preferences → `Monitor: preference-not-met`.
5. **Candidate quality**
   - No candidate satisfying PMCC structure/liquidity/quote policy →
     `Monitor: no-qualifying-short-call` or `quote-quality`.
6. **Economic comparison**
   - Candidate passes hard gates. The system compares credit, bid/ask cost,
     upside surrendered versus target, and net delta retained.
   - If policy says the retained upside is more valuable than the offered
     carry → `Hold uncovered` with the tradeoff explained.
   - Otherwise → `Review income call` with one selected candidate and ranked
     alternatives.

### 6.2 Hard gates versus preferences

Hard gates are fail-closed: identity, foundation relationship, capacity,
freshness, market session, liquidity, and quote-quality. A score cannot
override them.

Preferences are transparent and user-adjustable: DTE range, delta range,
minimum credit, earnings permission, posture, and income-cap strike. They
can produce `Monitor` or re-rank candidates but cannot be disguised as
structural safety failures.

### 6.3 The economics explanation

The system must show, rather than conceal, the reason a candidate won:

```text
Credit received: $X
Credit / LEAPS capital: Y%
Short strike / income cap: $A / $B
Upside available to thesis target before the cap: $C
Net delta: long D - short D = retained D
Earnings/event during cycle: Yes / No
Bid/ask quality: pass / fail
```

There is no single universal “PMCC score.” A composite ranking may order
otherwise eligible candidates, but the decision card must surface the
underlying evidence and rule outcomes.

## 7. Experience design

### 7.1 One Position Intelligence screen

The broker-held LEAPS detail screen has five progressive sections, in this
order:

1. **Next decision** — one state, primary reason, freshness, and the sole
   allowed CTA (when any).
2. **Long-call health** — entry debit, executable exit value, current P/L,
   exit-to-wash gap, expiration break-even, DTE, delta, intrinsic/extrinsic
   value, and thesis health.
3. **Income-cycle tradeoff** — candidate terms, credit, upside cap, retained
   delta, thesis-target tradeoff, and event status.
4. **Mandate and portfolio context** — editable mandate, allocation,
   concentration, and warnings.
5. **Decision history** — prior decisions, evidence snapshot, user action,
   resulting cycle, and outcome.

The initial view must be readable without knowing Greeks. Tooltips and an
expandable “Learn this” drawer explain each metric in plain language.

### 7.2 State presentation

| State | Headline | CTA | Required plain-language explanation |
|---|---|---|---|
| Hold uncovered | Preserve upside | None or “Review tradeoff” | The candidate credit does not justify the upside cap under this mandate. |
| Review income call | Review income call | Review PMCC short call | Shows exact candidate, upside cap, credit, and retained exposure. |
| Monitor | Monitor: [reason] | None or “Set review reminder” | States exactly what must change. |
| Reassess thesis | Reassess LEAPS thesis | Review position | Explains invalidation/health concern; never quietly substitutes an income call. |
| Not ready | Broker evidence required | Refresh / resolve | Names the unavailable or mismatched evidence. |
| Market closed | Recheck during market hours | None | Shows last-known evidence as history only. |

Never use “best time,” “safe,” “guaranteed income,” or “sell now.”

### 7.3 Handoff and execution

`Review income call` passes the exact account, position key, long OCC symbol,
contract count, candidate identity, and policy version to existing PMCC
review. PMCC review must reacquire fresh broker and quote data and may block
or select a different candidate if evidence changed.

The handoff never creates a local position, auto-submits an order, or falls
back to ticker-only PMCC discovery.

## 8. Decision ledger and learning loop

Every calculated action state and every user decision is append-only.

```ts
type LeapsDecisionLedgerEntry = {
  id: string;
  positionIdentity: ExactLongIdentity;
  calculatedAt: string;
  policyVersion: string;
  state: LeapsDecisionState;
  evidenceSnapshot: LeapsPositionIntelligence;
  userAction: 'reviewed' | 'opened-short-call' | 'skipped' | 'held-uncovered' | 'reassessed' | null;
  userRationale: string | null;
  laterOutcome: {
    premiumRetained: number | null;
    rollCost: number | null;
    upsideCapped: number | null;
    realizedPnl: number | null;
  } | null;
};
```

The system can later report policy results by posture, DTE/delta range,
event treatment, and ticker group. It must never retrofit prior decisions
with a new policy version or present hindsight as a live recommendation.

## 9. Alerts and review triggers

Alerts are reminders to review evidence, not instructions to trade. A user
can enable or mute each trigger:

- DTE crosses a mandate threshold;
- underlying nears the income-cap or active short strike;
- short-call delta crosses a chosen challenge threshold;
- earnings/catalyst enters the active cycle window;
- quote quality or liquidity degrades;
- existing short call expires, closes, fills, or is canceled;
- long-call thesis invalidation threshold is crossed;
- concentration/allocation policy is exceeded.

No recurring alert may generate an order or convert an old candidate into a
current recommendation without a fresh evaluation.

## 10. Data contracts and ownership

| Data | Source of truth | Owner / adapter | Freshness behavior |
|---|---|---|---|
| Positions, quantities, account, OCC identity | Broker | Portfolio snapshot adapter | Fail closed if stale/mismatched |
| Orders and foundation capacity | Broker | Coverage allocation / PMCC foundation engine | Fail closed if incomplete |
| Option quotes, OI, Greeks, IV | Broker/market data | Shared PMCC chain and quote adapter | Fail closed for a Review state; preserve contract-level bid/ask/mid, Greeks, OI, IV when available |
| Earnings and catalyst calendar | Broker earnings field plus future approved event source | Event adapter | Current source is insufficiently governed; show `unknown` / Monitor until source timestamp and failure semantics exist |
| Thesis mandate and user decision | TradeEdge | Mandate and ledger repository | Versioned and append-only |
| Concentration and allocation | Normalized portfolio snapshot | Portfolio context evaluator | Show unavailable, never assume low risk |

## 11. Technical architecture

The following existing capabilities are retained and become dependencies,
not competing implementations:

- normalized broker Portfolio snapshot and exact position identity;
- PMCC foundation verification and capacity reservation;
- shared PMCC chain acquisition, quote-quality policy, pairing, and production
  evaluator;
- Portfolio recommendation / Position Intelligence presentation;
- decision-review persistence;
- PMCC broker review and order lifecycle.

New work is a **single orchestration layer**:

```text
Broker snapshot + market snapshot + user mandate + policy version
                              ↓
                LEAPS Position Intelligence evaluator
                              ↓
        canonical decision object + evidence + ledger entry
              ↙                 ↓                  ↘
      Portfolio detail     PMCC review          LEAPS history
```

Requirements:

- pure, server-testable evaluator for deterministic policy;
- client rendering consumes serialized outputs and performs no policy math;
- market acquisition remains behind shared adapters;
- full identity and policy version included in every evaluator result;
- extend normalized long-call facts with contract-level bid, ask, mid, delta,
  IV when supplied, OI, and broker quote timestamp; do not use the underlying
  IV as a contract-IV substitute;
- structured reason codes, not copy-string comparisons;
- feature flag and safe fallback to the current Portfolio view;
- observability for stale evidence, blocked handoffs, data-source failure, and
  policy outcome distribution.

## 12. Definition of done

This is complete only when all of the following work together in production:

1. A broker-held standalone LEAPS has one canonical decision object.
2. Portfolio renders the five-section Position Intelligence experience from
   that object.
3. The current LEAPS scanner, Portfolio, and PMCC review agree on exact long
   identity, capacity, DTE rules, quote policy, and pairing rules.
4. The system can distinguish Hold uncovered from Review income call using
   documented mandate and economics evidence.
5. Every non-actionable state has one named reason and a clear next review
   trigger.
6. A PMCC action stays exact-foundation-bound and is revalidated before order
   review.
7. Position-level and portfolio-level concentration warnings are available or
   explicitly disclosed as unavailable.
8. Decision history records facts at the time of the decision and supports
   outcome review without hindsight rewriting.
9. Conventional stock covered-call behavior is unchanged.
10. Tests cover golden financial examples, all decision states, stale/missing
    evidence, assignment/capacity edge cases, event policy, mandate changes,
    handoff revalidation, and decision-ledger immutability.

## 13. Required design deliverables from Diane

Before build tickets are issued, Diane produces one linked mockup set for:

1. Healthy LEAPS in **Hold uncovered**.
2. Qualified **Review income call** candidate and tradeoff disclosure.
3. Each Monitor reason, including an event-window state.
4. **Reassess thesis** and **Not ready** states.
5. Existing active PMCC cycle / capacity-reserved state.
6. Mandate editing and mandate-change confirmation.
7. Decision history and plain-language metric education.
8. Mobile layout and accessibility states.

Each mockup must retain the existing TradeEdge visual system, distinguish
facts from preferences and rankings, and avoid requiring manual value entry
where preset choices or broker data are appropriate.

## 14. Dane technical discovery — resolved constraints

### 14.1 Current broker facts

- `lib/portfolio-data/acquisition.ts`, consumed by
  `lib/portfolio-snapshot/acquire.ts`, is the mature acquisition path.
- For an unambiguous standalone long call, entry debit per share is
  `Position.legs[0].avgOpenPrice` only when entry economics are complete, the
  entry effect is Debit, and exactly one long-call leg exists. `entryCredit`
  must not be used as a LEAPS debit.
- `currentValue` is observational/mid value. `closeValue` is the executable
  marketable exit total; per-share executable exit is
  `closeValue / (100 × quantity)` when a real non-crossed two-sided quote
  exists.
- `quoteCapturedAt` is the broker-provided oldest leg timestamp and must never
  be replaced by page-render time. `netDelta` is position-level and reliable
  for one exact long leg. `Position.iv` is underlying IV, not contract IV.
- Required schema expansion: preserve contract-level bid, ask, mid, delta,
  IV if supplied, OI, and broker timestamp, or reacquire them through the
  shared chain adapter.

### 14.2 Durable mandate and ledger persistence

Existing position-intent, decision-review, and entry-snapshot stores are
mutable user-scoped Redis JSON blobs. They are not suitable for an
account-scoped append-only LEAPS decision ledger.

Create `lib/leaps-position-intelligence/persistence` with:

- current mandate key:
  `leaps-mandate:${userId}:${account}:${occ}`;
- immutable event stream:
  `leaps-ledger:${userId}:${account}:${occ}`;
- event IDs and idempotency keys;
- no update/delete route for ledger events; and
- atomic mandate-write plus ledger-append using the established Redis and
  Lua/eval pattern when both must commit together.

### 14.3 Event and portfolio-context constraints

Broker market metrics expose a next-earnings field within a limited window,
but the current contract lacks a retained source timestamp and the PMCC
pairing engine does not presently gate it. Until that contract is extended,
event policy must show unknown/Monitor rather than treating the absence of an
event as a green light.

Portfolio concentration is feasible from unique normalized positions and
equity holdings with reliable marks. Correlation, sector, and theme data do
not currently exist in the normalized snapshot; v1 must label them
unavailable rather than fabricate a concentration score.

### 14.4 Evaluator and rollout

Add pure, server-testable modules:

```text
lib/leaps-position-intelligence/types.ts
lib/leaps-position-intelligence/policy.ts
lib/leaps-position-intelligence/evaluate.ts
lib/leaps-position-intelligence/persistence/*
```

The evaluator receives serialized snapshot facts, an exact long position,
shared PMCC evaluator output, mandate, and event/context facts. It returns
structured codes and evidence only. Browser authorization and market
acquisition stay outside it.

Reuse `pmcc-foundations`, `pmccChainAdapter`, `pmccPairing`, and
`pmccProduction`; extract a shared adapter once and delete any local wrapper
rather than duplicate it.

Introduce disabled-by-default
`NEXT_PUBLIC_LEAPS_POSITION_INTELLIGENCE_ENABLED`. Shadow-evaluate first for
parity telemetry, retain the current PMCC readiness UI as fallback, and only
show the canonical UI after fixture and live-parity gates pass. Every
migration requires exact account and OCC identity; there is no ticker-only
fallback.

## 15. Review amendments — binding for v1

This section incorporates the financial-policy, design, and safety reviews.
If it conflicts with an earlier section, this section controls.

### 15.1 Explicit policy contract

The evaluator accepts one versioned `LeapsDecisionPolicy` record. It contains
all adjustable trader-policy values and all non-adjustable safety values. A
positive action requires every applicable value to be present.

```ts
type LeapsDecisionPolicy = {
  version: string;
  safety: {
    maxBrokerSnapshotAgeMs: number;
    maxOrderSnapshotAgeMs: number;
    maxOptionQuoteAgeMs: number;
    maxEventDataAgeMs: number;
    minimumLongDteForThesis: number;
    // Active-cycle / revalidation floor. New-cycle qualification continues to
    // use the separate long-DTE health floor and approved short-DTE range.
    minimumLongDteAfterShortExpiry: number;
    minimumOpenInterest: number;
    maximumBidAskWidthPct: number;
    requireTwoSidedNonCrossedQuote: true;
  };
  mandate: {
    shortDte: { min: number; max: number };
    shortDelta: { min: number; max: number };
    minimumCycleCredit: number | null;
    incomeCapStrike: number | null;
    minimumUpsideParticipationPct: number | null;
    allowKnownEarningsCycle: boolean;
  };
};
```

Initial numeric values are not silently invented by the UI. Ian supplies an
approved, versioned default-policy fixture and golden examples before code is
enabled. The v1 defaults are user-visible starting points—not silent universal
thresholds or recommendations. A trader may edit the mandate values within
allowed bounds; once saved they are **binding trader-policy gates**, not mere
ranking preferences.

### 15.2 Deterministic Hold-uncovered versus Review rule

The evaluator must never return the opaque statement “retained upside is more
valuable than carry.” It returns the following facts and rule result:

```text
candidate credit is executable only = conservative short-call bid × contracts × 100
estimated closing friction = current bid/ask cost disclosed separately
candidate short strike >= saved income-cap strike
upside participation =
  (short strike - underlying price) / (thesis target high - underlying price)
```

When a valid thesis target high is above spot, the candidate must meet the
saved `minimumUpsideParticipationPct`. When the target is missing, at/below
spot, or the participation calculation is undefined, the system cannot infer
the tradeoff: it returns `Monitor: preference-not-met` and asks for a mandate
review. `creditAsPctOfLeapsCapital` is unavailable when verified entry debit
is unavailable; it is never derived from a proxy.

`Review income call` requires all structural safety gates, all saved
trader-policy gates, and this tradeoff calculation to pass. The state map is
explicit:

- valid target, otherwise-safe/liquid candidate, and participation below the
  saved minimum → `Hold uncovered`, with the failed comparison shown;
- missing/invalid target, missing mandate, or any unmet binding gate other
  than that single participation comparison → `Monitor: preference-not-met`;
- all gates and the participation comparison pass → `Review income call`.

The UI shows the active policy version and failed comparison. It does not call
this a forecast or probability.

### 15.3 Event, assignment, and market-data protection

Add the standardized Monitor reason `event-data-unavailable`. It applies when
earnings, corporate-action, ex-dividend, or assignment-relevant event data is
missing, stale, or lacks an approved source timestamp. Unknown is not the
same as no event.

- A known event inside the proposed short-call life produces `Monitor:
  event-window` unless the saved mandate explicitly permits that **known**
  earnings cycle.
- Permission for known earnings never permits unknown or stale event data.
- Elevated ex-dividend, corporate-action, or early-assignment conditions
  produce a named Monitor or Not-ready state according to evidence quality.
- A short candidate is action-blocked unless broker positions/orders and
  option quotes have source timestamps within policy thresholds, the quote is
  two-sided and non-crossed, OI meets the minimum, and bid/ask width meets
  the policy limit.
- Credit uses the conservative executable bid. The UI shows per-share,
  per-contract, and total credit, plus closing friction and quote timestamp.

### 15.4 Decision precedence

The evaluator returns the highest-priority applicable state in this order:

1. `Not ready` for identity, authorization, structural foundation, position/
   order freshness, or quote evidence failure.
2. `Reassess thesis` for a deterministic mandate invalidation or long-DTE
   health threshold breach, with the underlying evidence retained.
3. `Market closed` only when identity and broker freshness are valid and no
   higher-priority attention state applies. It suppresses fresh PMCC action
   but does not hide invalidation or stale-identity attention.
4. `Monitor` for active-cycle capacity, event policy, candidate quality, or
   binding trader-policy conditions.
5. `Hold uncovered` or `Review income call` after all preceding gates pass.

The long-call health rule is separate from PMCC pairing: when long-call DTE is
strictly below `minimumLongDteForThesis`, the system returns `Reassess thesis`
and explains that the LEAPS no longer has the saved minimum horizon. At or
above that boundary, long-DTE health passes. For a new cycle, long-DTE health
and the approved short-DTE range establish the initial eligibility horizon.
`minimumLongDteAfterShortExpiry` is an active-cycle and revalidation floor: if
the remaining long horizon falls below that floor after the active short's
expiry, the system requires a management review and cannot extend/replace the
cycle without explicit reconfirmation. Exact contract quantity and unreserved
capacity are checked again immediately before review and before order
submission.

### 15.5 Exact handoff and reconfirmation

The PMCC review handoff binds:

- opaque authorized account ID;
- exact long OCC, position identity, contract quantity, and allocation;
- exact selected short OCC;
- quote snapshot identifiers/timestamps and material economics;
- policy version.

If revalidation changes the candidate, capacity, quote freshness, credit,
strike, DTE, delta, or any material identity/economic field, the flow blocks
and returns to candidate review. It must never silently substitute another
short call. The trader must see the change and explicitly reconfirm.

Candidate review always discloses early-assignment possibility, the absence
of automatic exercise or roll, and the required close/roll/reassess decision
when the short call is challenged. Net delta is a useful exposure measure,
not a complete risk measure.

Candidate review also compares the proposed short strike with the long
LEAPS's original expiration break-even. When the cap is below that break-even,
the UI presents a prominent warning: the short call can cap a recovery before
the original debit is recovered. This is a decision warning, not an automatic
prohibition; the trader may have deliberately chosen that mandate.

### 15.6 Durable ledger and privacy

Ledger entries are immutable facts. An outcome is a new immutable event that
references the prior decision; it is not a mutable `laterOutcome` field.
Every event contains a generated ID, idempotency key, actor, request ID,
created timestamp, policy version, retention/recovery metadata, and access
control checks.

Persistence keys and API contracts use an opaque canonical account ID. Raw
account numbers are redacted from UI where not required and never included in
logs, telemetry labels, broad serialized payloads, or client-visible key
names. Every request verifies the requesting user's authorization for that
account and exact position identity.

### 15.7 Safe rollout and rollback

The feature flag rollout has four explicit stages:

1. **Disabled:** no new UI, no writes, no PMCC behavior change.
2. **Shadow evaluation:** canonical evaluator runs read-only for authorized
   diagnostic cohorts; it creates no mandate, ledger, alert, or order write.
   Record parity against current readiness and structured disagreement reason.
3. **Limited UI cohort:** enable read-only decision display only after
   approved fixture coverage and a documented parity threshold are met.
4. **Review routing cohort:** enable the exact-bound PMCC review CTA only
   after monitoring shows no unresolved identity, freshness, or candidate
   substitution failures.

Each stage has telemetry, dashboards, an owner, and a tested immediate
feature-flag rollback. Rollback preserves immutable historical records and
cannot leave an orphaned mandate/ledger migration. Shadow mode and every
rollback path are explicitly no-order and no-write except approved diagnostic
telemetry.

### 15.8 Design decisions required before mock approval

Diane's linked prototype must represent these resolved rules and obtain
product signoff for its exact interaction choices:

- no mandate starts in health-only mode with a guided, optional mandate setup;
  it cannot produce an income-call Review state;
- event-data unknown is visually distinct from “no event in cycle”;
- the decision card exposes the active policy basis for any hold/review
  tradeoff without overwhelming the initial view;
- history has a concise timeline row plus expandable immutable audit evidence;
- reminders are in-app review prompts in v1, can be muted, and never place or
  refresh a trade automatically;
- portfolio concentration cards distinguish calculated warnings from missing
  sector/theme/correlation evidence on every decision card.

### 15.9 Required golden cases

Before a user-visible cohort, deterministic tests cover: unknown event data;
known allowed earnings cycle; ex-dividend/assignment warning; stale, one-sided,
or crossed quotes; long-DTE health boundary; active-cycle/revalidation buffer boundary;
income-cap/target boundary;
missing entry debit; no mandate; state precedence; changed candidate on
handoff; ledger idempotency/immutability; account authorization; and rollback
with no orphaned records.

## 16. Approval questions

- **Paul:** Does this define one durable product rather than a succession of
  partial PMCC features?
- **Ian:** Are hard gates, preference gates, and the Hold-uncovered versus
  income tradeoff correctly separated?
- **Diane:** Is the experience understandable for a newer trader without
  hiding the professional evidence?
- **Alan:** Are the long-call and short-call economic concepts presented
  accurately and without false certainty?
- **Quinn:** Are broker identity, freshness, exact-foundation handoff, and
  ledger immutability sufficient safety boundaries?
- **Dane:** Is the architecture feasible against the current codebase, and
  what discovery finding changes scope, sequencing, or data contracts?
