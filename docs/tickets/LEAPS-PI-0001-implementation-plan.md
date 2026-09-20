# LEAPS-PI-0001 — LEAPS Position Intelligence Implementation Plan

**Status:** Implementation plan for Dane; no implementation is authorized by this document alone.  
**Inputs:** Product/design specification v1; Ian's `LEAPS-PI-1.1` policy fixture.  
**Scope:** Broker-held standalone long calls / LEAPS and their optional PMCC income cycles. Conventional stock covered calls are explicitly out of scope and must remain behaviorally unchanged.

## 1. Delivery rule

This is one durable system, delivered in dependency order. No screen may create its own LEAPS health, PMCC eligibility, ranking, freshness, or economics logic. Until the canonical evaluator is enabled, the current Portfolio PMCC-readiness presentation remains the fallback.

The final authoritative flow is:

```text
broker snapshot + shared live PMCC market facts + event facts + saved mandate
                                   ↓
                   pure LEAPS Position Intelligence evaluator
                                   ↓
          canonical snapshot / coded state / evidence / policy version
               ↙                    ↓                     ↘
      Portfolio detail      PMCC review handoff       append-only ledger
```

## 2. Existing code to reuse (not copy)

| Capability | Existing owner | Required use |
|---|---|---|
| Broker account, options, quote acquisition | `lib/portfolio-data/acquisition.ts` | Extend the existing normalized `Position` facts; do not make a second positions fetcher. |
| Account-scoped snapshot/data quality | `lib/portfolio-snapshot/acquire.ts`, `types.ts`, `dataQuality.ts` | Input boundary for Portfolio evaluator orchestration. |
| Exact held-LEAPS capacity | `lib/scans/pmcc-foundations.ts` | Exact OCC foundation and unavailable/ambiguous capacity are hard gates. |
| PMCC chain adaptation and pairing | `lib/scans/pmccChainAdapter.ts`, `pmccPairing.ts`, `pmccQuoteQuality.ts`, `pmccProduction.ts`, `pmccConfig.ts`, `pmccDteRanges.ts` | Canonical source for chain legs, DTE/delta/OI, quote policy, pairing, and candidate identity. Extract a local page helper only once if one still exists; never fork pairing logic. |
| Current held-LEAPS readiness | existing `evaluateHeldPmccLiveReadiness` integration / Portfolio PMCC card | Preserve as fallback while shadowing canonical output; then replace its decision logic with an adapter to the canonical result. |
| Portfolio positions UI | `features/portfolio/positions-workspace/*` and `components/portfolio-data/PortfolioDataProvider.tsx` | Render serialized intelligence only; no policy arithmetic in React. |
| PMCC broker review/order lifecycle | current PMCC review/handoff path in `app/screener/page.tsx` | Revalidate account, exact OCC foundation, capacity, candidate identity, and fresh quote before review. Do not auto-submit. |
| User decision concepts | `lib/trader-commitments/*`, `lib/decision-review/*` | Reuse types/UX conventions where compatible, but do not use their mutable stores as the LEAPS immutable ledger. |
| Durable Redis/atomic write pattern | `lib/autopilot/persistence/redis.ts`, `lib/paper-trading/persistence/commit.ts` | Use server-side Redis with an atomic precondition-checked append for mandate change + ledger event. |

## 3. New canonical package and contracts

Create `lib/leaps-position-intelligence/`:

```text
types.ts                 canonical snapshot, coded evidence/reasons, mandate, ledger event
policy.ts                LEAPS-PI-1.1 constants and policy version
facts.ts                 maps normalized broker/market facts into evaluator input
economics.ts             pure long-call and PMCC tradeoff calculations
thesisHealth.ts          deterministic mandate/DTE/data-quality thesis state
portfolioContext.ts      position-key-based exposure/concentration facts
evaluate.ts              ordered pure decision waterfall
handoff.ts               exact identity/policy-version handoff contract validation
persistence/*.ts         mandate repository, immutable ledger repository, validators
index.ts
__tests__/*
```

`evaluate.ts` accepts facts only; it performs no fetch, Redis, localStorage, React, or broker-token work. It emits structured reason codes and evidence—not presentation strings. The policy ordering is fixed: evidence validity; thesis health; active cycle/capacity; event/mandate preferences; candidate quality; economic comparison; state output.

### Required normalized data migration

Extend `Position`/the acquisition mapping only where a single exact long call can be proven:

- preserve per-leg bid, ask, mid, broker quote timestamp, delta, contract IV if broker-supplied, open interest, and quote-quality evidence;
- preserve entry debit/share from the exact `PositionLeg.avgOpenPrice` only when `entryEconomicsComplete`, debit price effect, and unambiguous one-long-call structure hold;
- preserve marketable exit facts from existing `closeValue` (long calls use bid) and retain null when a two-sided non-crossed quote is absent;
- retain `Position.iv` as underlying IV only; do not relabel it contract IV;
- add a broker snapshot ID/as-of and wire `PortfolioSnapshot.quoteAsOf` from actual broker quote evidence rather than fabricated acquisition time.

No migration may reinterpret legacy `entryCredit`, `creditReceived`, `currentValue`, or position P/L fields as long-call debit evidence. Historical rows without full evidence remain usable for health display but cannot produce Review income call.

## 4. Persistence and API plan

Create account-and-exact-OCC scoped API/repositories, authenticated from the server session. Use the opaque authorized canonical account ID at every persistence and client/API boundary; raw broker account numbers must never appear in Redis keys, logs, telemetry, or client-visible payloads:

- current mandate key: `leaps-mandate:${userId}:${canonicalAccountId}:${longOccSymbol}`;
- ledger stream key: `leaps-ledger:${userId}:${canonicalAccountId}:${longOccSymbol}`;
- optional current calculated snapshot cache: explicitly non-authoritative and expiry-bounded; ledger is the history.

Mandate updates validate all fields, perform optimistic/idempotency checks, store the new current mandate, and append a `mandate-changed` ledger event atomically. Decision snapshots, user actions, and realized outcomes append separate events only; no existing event gets mutable “later outcome” fields. There is no PUT/upsert/delete for old entries. The opaque account ID and OCC in the route payload must match the authorized broker snapshot; position-key-only lookup is insufficient. Server-only resolution may use the broker account number after authorization.

Do not reuse `/api/position-intent` or `/api/decision-reviews`: both are user-only mutable JSON blobs; `decision-reviews` is an upsert store, contrary to the ledger contract.

## 5. Event and concentration prerequisites

The only present event source is Tastytrade `market-metrics`, read in `loadPositions()` as next earnings (roughly 60 days). It has no source timestamp and currently only survives as `Position.earningsDate` when inside the position expiry. Add an event-fact adapter with source, as-of, event type, and 15-minute freshness. Until that is delivered, return `Monitor: event-data-unavailable` for every potential `Review income call` state—never assume no earnings. Permission for a known earnings event never treats unknown or stale event data as clearance.

Portfolio context starts with a documented, same-account aggregation:

- equity holdings by normalized `symbol`;
- options by unique resolved `Position.key`, using `netDelta` and marketable/current value only when reliable;
- never sum individual PMCC legs and the grouped position together;
- null/ambiguous positions yield an availability warning rather than a low-risk result.

Sector/theme/correlation groups are absent from the current snapshot. The first release must display those dimensions as unavailable, not derive them from beta or invent a proxy. A later approved market taxonomy/correlation adapter can populate them.

## 6. Dependency-ordered tickets

### LEAPS-PI-0001A — Canonical facts and policy evaluator

Build the package types, `LEAPS-PI-1.1` policy fixture, economic calculations, long-call thesis health, structured evidence/reasons, and pure waterfall. Extend normalized facts as in section 3. No user-facing decision replacement yet.

**Depends on:** none.  
**Blocks:** every subsequent ticket.  
**Acceptance:** evaluator has no fetch/React/Redis imports; all fixture states are deterministic and explainable. The 120-DTE boundary is named and implemented only as the active-cycle/revalidation buffer, never as a second new-cycle eligibility floor.

### LEAPS-PI-0001B — Mandate and immutable decision ledger

Implement server repository/API, append-only events, exact account/OCC scoping, authorization, idempotency, parser/version migration, and mandate-change events. Add mandate display/edit UI only behind the feature flag; it writes no policy calculation client-side.

**Depends on:** 0001A canonical types.  
**Blocks:** meaningful user-tailored decision and history.

### LEAPS-PI-0001C — Live PMCC facts, event adapter, and portfolio context

Create one orchestration adapter that acquires current shared PMCC chain/result for the held exact foundation, maps candidate economics, capacity and quote freshness into 0001A input, and adds the governed earnings fact. Add same-account position-key aggregation and explicit unavailable context for correlation/theme.

**Depends on:** 0001A; integrates but does not alter PMCC pairing.  
**Blocks:** live Review/Monitor/Hold state.  
**Stop condition:** no approved event source/freshness contract means only event-data-unavailable, not an invented clear state.

### LEAPS-PI-0001D — Portfolio Position Intelligence experience

Replace only the LEAPS/PMCC portion of the existing Portfolio detail with the five specification sections, driven exclusively by serialized canonical output. Build Diane-approved responsive/accessibility states and education drawer. Retain conventional covered-call cards/rules/source output unchanged.

**Depends on:** 0001A–C and mockup approval.  
**Blocks:** user-visible rollout.  
**Acceptance:** implement and verify every approved prototype state: no-mandate health-only; Hold uncovered; Review income call; Monitor for capacity, no candidate, quote quality, preference, known event, unavailable event data, and assignment/corporate action; Reassess for invalidation and long-DTE health; Not ready; Market closed; active PMCC cycle; mandate validation/confirmation; changed-evidence reconfirmation; history/prompts; and ordered mobile stack. Decision cards visibly distinguish broker facts, safety gates, and binding trader policy; show quote/event source timestamps; and show executable credit per share, per contract, total, and closing friction. Show the selected candidate with ranked alternatives or a clear no-alternative/near-miss explanation. Require semantic status text/announcements, non-color state language, visible keyboard focus, keyboard-operable tabs/disclosures, and sensible focus after refresh/revalidation.

### LEAPS-PI-0001E — Exact PMCC review handoff and revalidation

Route `Review income call` using opaque canonical account ID, position key, long OCC, quantity, candidate OCC, candidate facts, policy version, and evaluation timestamp. At PMCC review, reacquire/revalidate all hard gates; if facts changed, block the prior handoff and return the user to candidate review with changed evidence and explicit reconfirmation for any replacement candidate. No ticker fallback and no automatic order. A candidate short strike below the verified long-call original-expiration break-even must show the approved prominent warning; it is never silently accepted merely because other economics gates pass.

**Depends on:** 0001C–D.  
**Blocks:** enabling the CTA.

### LEAPS-PI-0001F — Decision history, alerts, and outcome accounting

Render immutable timeline, user decision/rationale, separate immutable outcome events, user-controlled reminders, and outcomes by policy/posture. Alerts request review only and re-evaluate fresh facts before any candidate is displayed.

**Depends on:** 0001B–E.  
**Blocks:** full definition of done, but not safety of the earlier read-only/shadow rollout.

## 7. Golden tests and safety invariants

Add fixtures first, then implementation. Required cases include Ian's complete matrix:

1. no mandate health-only mode and every posture; 70/55/40% upside-participation equality plus just-inside/outside boundaries;
2. income-cap equality, below-cap rejection, missing/invalid target;
3. New-entry DTE exactly 270/720 and just outside; existing-position review exactly 180 and 179; active-cycle remaining horizon exactly 120 and 119;
4. broker/order snapshot five-minute and event 15-minute exact/inside/outside freshness boundaries;
5. market closed; missing, delayed, one-sided, crossed, stale quotes; absent entry debit;
6. exact account/OCC/quantity mismatch, adjusted/ambiguous deliverable, existing/working capacity, candidate replacement on revalidation;
7. known allowed/disallowed earnings, unknown/stale event data, ex-dividend/corporate-action warning;
8. economic math: strike + debit expiration breakeven, long bid executable exit, intrinsic/extrinsic, wash gap, credit-capital percentage, net delta, upside participation/surrender, and the prominent below-original-expiration-break-even cap warning;
9. portfolio aggregation proves no double counting of multi-leg/PMCC structures and marks unavailable data honestly;
10. append-only, authorization, concurrent/idempotent mandate change, no old-event mutation, policy-version preservation, flag-on/off fallback;
11. conventional covered-call snapshot/UI regressions prove no changed eligibility, source card, or action output.

Run package tests, affected snapshot/acquisition tests, existing PMCC pairing/production tests, Positions Workspace tests, type check, and `git diff --check`. Add a source-boundary test proving client UI does not import evaluator internals or calculate policy thresholds.

## 8. Rollout, observability, and rollback

1. Ship code behind `NEXT_PUBLIC_LEAPS_POSITION_INTELLIGENCE_ENABLED=false` (separate from the existing `NEXT_PUBLIC_LCC_0001A_SNAPSHOT_ENABLED`).
2. Shadow evaluate for exact held LEAPS only; log redacted state/reason/policy version, stale/failure counts, legacy-vs-canonical PMCC readiness disagreement, and blocked handoffs. Do not alter user actions or write decision events.
3. Review fixture parity and production telemetry with Ian, Quinn, Paul, and Diane. Explicitly resolve event-source availability before candidate/event-window enablement.
4. Enable append-only canonical decision-ledger writes before any limited user-visible decision cohort; history rendering may remain behind its own flag. Retain legacy readiness action as fallback.
5. Enable read-only Position Intelligence for a small cohort/account only after ledger-write verification; do not represent it as the complete product before immutable history, prompts, and outcome loop are enabled.
6. Enable Review income call only after E revalidation metrics show exact identity/candidate parity.
7. Enable history/prompts/outcome loop and user-controlled alerts last. A flag-off rollback returns to existing Portfolio PMCC readiness; it never deletes mandates or ledger events.

## 9. Completion criteria

Do not declare this complete until the specification's section 12 conditions are met: one canonical decision object; five-section Portfolio experience; shared identity/capacity/DTE/quote policy; explainable Hold versus Review outcome; named non-actionable states; exact revalidated handoff; honest portfolio-context availability; immutable history; unchanged stock covered calls; and all golden/safety tests passing.

## 10. Explicit non-goals for this build

- price prediction, guaranteed outcomes, automatic PMCC cycles, auto-rolling, auto-close/exercise, or broker order submission;
- correlation/thematic risk fabricated from beta;
- using a scanner candidate or ticker-only lookup to represent a broker-held foundation;
- treating missing event data as event clearance;
- parallel PMCC chain/pairing/score implementations;
- changing stock covered-call policy, capacity, presentation, or execution behavior.
