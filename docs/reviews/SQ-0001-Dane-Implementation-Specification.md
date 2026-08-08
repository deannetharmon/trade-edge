# SQ-0001 — Dane Implementation Specification

**Status:** COMPLETE — ready for Alan/Quinn implementation-readiness review  
**Inputs:** Sponsor-approved Alan architecture; Quinn quantitative specification; Alan/Ian/Paul reconciliation.  
**Scope:** Code boundaries, contracts, migration sequence, validation sequence, and file impact for BPS/BCS/IC decision-quality replacement.  
**Not authorized:** production formulas/weights, calibrated probabilities, Strong/A+ semantics, CSP/CC/Wheel/PMCC behavior.

## 1. Implementation Objective

Replace the current architecture in which one close-derived trend result and one additive candidate score jointly determine BPS/BCS/IC ranking with a staged, replayable decision path:

```text
PointInTimeMarketData
 -> MarketStateEvidence
 -> SetupClassification
 -> EventRiskEvidence
 -> StrategyThesis
 -> EligibilityDecision
 -> ContractCandidate
 -> ContractRanking
 -> DecisionTrace
```

Contract economics cannot create eligibility. All authoritative calculation stages are pure and accept point-in-time inputs; network/data acquisition remains outside the calculation path.

## 2. File Impact Manifest

### Existing files — MODIFY

#### `lib/scans/types.ts`

Role after migration: compatibility/scan transport types only; canonical decision-domain contracts move to dedicated modules.

Changes:
- stop treating `TrendResult.strategy` as canonical strategy selection;
- deprecate overloaded `TrendResult.confidence` semantics for the new path;
- adapt `RawScanEntry`/ranked transport to carry decision trace, eligibility, strategy/model/config identity;
- retain legacy fields only while legacy scan modes still require them.

#### `lib/scans/trend.ts`

Role after migration: legacy adapter during transition, not new decision authority.

Changes:
- extract reusable pure calculations into market-intelligence modules;
- stop adding new strategy-selection behavior here;
- preserve existing legacy behavior until the replacement path is promoted;
- explicitly remove/fix misleading MA200 fallback and close-extrema semantics when migrated.

#### `lib/scans/rank-scoring.ts`

Role after migration: legacy scorer/adapter until replacement promotion.

Changes:
- remove new-path thesis evidence from contract scoring;
- eliminate `range60` width-as-position semantic collision;
- route new-path ranking through strategy-specific contract rankers;
- retain legacy scorer only for baseline comparison/reproducibility until retirement.

#### `lib/scans/ranked-scan-runner.ts`

Role after migration: scan orchestration adapter.

Changes:
- replace exhaustive no-gate new-path flow with horizon -> evidence -> setup -> event risk -> thesis -> eligibility -> candidate generation/ranking;
- do not generate normal ranked recommendations for `INELIGIBLE` or `INSUFFICIENT_EVIDENCE` strategies;
- preserve legacy runner behind an explicit baseline/legacy path during validation.

#### `app/api/chart/route.ts`

Changes:
- preserve authoritative OHLC timestamps and actual highs/lows required by market-state evidence;
- add volume only if source availability/validation contract supports it;
- do not perform decision calculations in API route;
- ensure response semantics are named accurately.

#### `app/screener/page.tsx`

Changes:
- consume new ranked decision output rather than recomputing thesis semantics in presentation;
- remove new-path dependence on mutable legacy rank weights/thresholds;
- retain legacy controls only while legacy mode remains available;
- display categorical eligibility separately from numeric contract ranking.

#### `features/screener/components/RankedScoreTierSummary.tsx`

Changes:
- remove implication that unvalidated replacement scores are probabilities/confidence;
- present strategy-specific score semantics and model identity;
- do not promote Strong/A+ replacement labels until validation gate passes.

### Existing files — RETAIN / BASELINE

Legacy trend/scoring behavior must remain reproducible until historical comparison and rollout are complete. Do not delete legacy calculation code in the first implementation work package.

### New files — CREATE

#### Domain contracts

`lib/decision/types.ts`
- `DecisionHorizon`
- `SetupClassification`
- `EventRiskEvidence`
- `EligibilityStatus`
- `EligibilityDecision`
- `DecisionTrace`
- `ModelVersion`
- `ConfigVersion`

`lib/market-intelligence/types.ts`
- `PointInTimeBar`
- `PointInTimeMarketData`
- `MarketStateEvidence`
- direction/strength/persistence/regime/maturity/uncertainty evidence contracts
- explicit range-width vs range-position fields

#### Market intelligence

`lib/market-intelligence/features.ts`
- pure OHLC feature calculations;
- actual swing high/low structure;
- returns/slopes/MA semantics;
- true range/ATR-ready primitives;
- range width and price-in-range position as distinct outputs;
- no network calls.

`lib/market-intelligence/market-state.ts`
- converts validated features into canonical evidence structure;
- does not select BPS/BCS/IC;
- no contract strikes or option economics.

`lib/market-intelligence/horizon.ts`
- versioned SHORT/CORE/EXTENDED research mapping;
- mapping deterministic and separately testable;
- boundaries configuration/versioned, not scattered constants.

#### Setup/event layer

`lib/decision/setup-classifier.ts`
- market evidence -> continuation/reversal/range/transition/chaotic classification;
- setup identity survives downstream.

`lib/decision/event-risk.ts`
- point-in-time known event evidence;
- can contribute to ineligible/insufficient-evidence before contract ranking;
- must preserve knowledge timestamp/source semantics required for replay.

#### Strategy thesis

`lib/decision/strategy-thesis/bps.ts`
- threatened-side downside-control thesis;
- bullish/bullish-neutral compatible;
- continuation and reversal distinguishable;
- no premium/delta/liquidity/credit inputs.

`lib/decision/strategy-thesis/bcs.ts`
- threatened-side upside-control thesis;
- independently defined/validated, not sign-inverted BPS;
- no contract economics.

`lib/decision/strategy-thesis/ic.ts`
- affirmative two-sided containment thesis;
- explicit upper containment, lower containment, weaker side, transition/breakout evidence;
- no candidate strike may manufacture thesis eligibility.

`lib/decision/strategy-thesis/types.ts`
- generic thesis envelope plus strategy-specific evidence payloads and reason codes.

#### Eligibility

`lib/decision/strategy-eligibility.ts`
- authoritative `ELIGIBLE | INELIGIBLE | INSUFFICIENT_EVIDENCE` decision;
- consumes thesis + event risk + horizon/version context;
- emits reason codes;
- never consumes contract economics.

#### Contract ranking

`lib/decision/contract-ranking/types.ts`
- normalized strategy-specific ranking contract;
- score is not probability;
- includes component trace and model/config identity.

`lib/decision/contract-ranking/bps.ts`
`lib/decision/contract-ranking/bcs.ts`
`lib/decision/contract-ranking/ic.ts`
- rank only candidates whose strategy is eligible;
- consume contract economics such as delta, buffer, expected-move clearance, liquidity, credit/ROC, IV/event compatibility, DTE;
- no hidden raw score > normalized contract followed by silent cap.

#### Orchestration

`lib/decision/evaluate-strategy.ts`
- pure orchestration from market-state/setup/event/thesis/eligibility to contract ranking for one strategy/horizon;
- returns full `DecisionTrace` including ineligible/insufficient states.

`lib/decision/evaluate-underlying.ts`
- computes shared market evidence once per appropriate horizon and evaluates BPS/BCS/IC independently;
- does not assume scores are cross-strategy comparable.

#### Position/lifecycle extension contracts

`lib/decision/position-state.ts`
- define extensible position/portfolio state envelope only;
- no Wheel behavior in SQ-0001.

`lib/decision/lifecycle/types.ts`
- extension seam for future CSP/CC/Wheel/PMCC lifecycle actions;
- no authoritative lifecycle implementation this work package.

#### Replay / validation

`lib/validation/types.ts`
- replay snapshot, generated decision, outcome labels, model/config identity.

`lib/validation/replay.ts`
- execute the same pure decision path against point-in-time snapshots;
- prohibit live acquisition inside replay calculation.

`lib/validation/outcomes.ts`
- BPS/BCS: strike touch/challenge, MAE, thesis break, terminal relation, fixed-policy realized outcome;
- IC: either-side touch, breakout side, side-specific excursion, containment, fixed-policy realized outcome.

`lib/validation/score-bins.ts`
- same-strategy monotonicity analysis support;
- no qualitative promotion labels until empirical gate passes.

## 3. Test Manifest

Create targeted tests alongside modules or under the repository's established test convention. Required suites:

- market feature semantics: OHLC highs/lows, range width vs position, MA lookback identity;
- horizon mapping/versioning;
- setup classification traceability;
- event-risk point-in-time behavior;
- BPS contradictory-thesis invariant;
- BCS independent/non-sign-inversion invariant;
- IC two-sided containment/weaker-side invariant;
- insufficient-evidence categorical behavior;
- contract economics cannot alter eligibility;
- ranking normalization/no saturation;
- decision trace/model/config identity;
- replay determinism and future-data leakage guard;
- baseline compatibility for legacy scorer during migration.

## 4. Dependency Order

Implementation must proceed in this order:

1. canonical types/version contracts;
2. horizon + pure OHLC feature calculations;
3. market-state evidence;
4. setup + event-risk evidence;
5. BPS/BCS/IC thesis contracts;
6. eligibility gate;
7. contract-ranking contracts/strategy rankers;
8. pure evaluate-strategy/evaluate-underlying orchestration;
9. replay/outcome harness;
10. ranked-scan-runner adapter;
11. Screener transport/UI adaptation;
12. empirical validation;
13. production promotion/legacy retirement only after approval.

A later step cannot be used to compensate for an unresolved earlier contract.

## 5. Migration Strategy

Use dual-path migration:

- `legacy`: current getTrend + scoreCandidate behavior retained for baseline comparison;
- `sq0001`: new staged decision path.

During development/validation, the new path may run in shadow/non-authoritative mode. It must not silently replace user-facing authoritative ranking before empirical acceptance gates pass.

Every captured decision records path/model/config version so comparisons are reproducible.

## 6. Explicit Non-Goals

Do not in this implementation specification:

- choose production feature weights or thresholds;
- label score as probability/confidence;
- claim 70/80/90 corresponds to win rate;
- implement CSP, CC, Wheel or PMCC decision behavior;
- make BCS an inverse BPS implementation;
- make IC eligibility equivalent to weak direction;
- allow option contract attributes to determine underlying thesis eligibility;
- delete legacy scorer before baseline validation is complete;
- add unvalidated indicators simply because they are commonly used by traders.

## 7. Validation / Promotion Sequence

### Code-level gate
- targeted tests while implementing;
- one full test run;
- one TypeScript run;
- one production build;
- no redundant environment/dependency health work.

### Quantitative gate
- point-in-time dataset/replay established;
- chronological train/tune/test or equivalent frozen evaluation protocol;
- BPS, BCS, IC reported separately;
- horizon buckets reported separately;
- compare current production baseline vs new eligibility/ranking;
- report coverage, touch/challenge, MAE, thesis break, realized outcomes, score-bin monotonicity;
- no promotion based on one metric.

### Team gate
- Quinn: validation evidence and leakage/testability;
- Ian: systematic trader-thesis failure review/blind chart benchmark;
- Paul: semantics match demonstrated evidence;
- Sam: user can distinguish eligibility, ranking, and probability;
- Alan: architecture remained intact through implementation.

Only after those gates may replacement behavior become authoritative.

## 8. Legacy Retirement Candidates

After successful promotion—not during initial implementation—review for retirement/migration:

- strategy selection embedded in `TrendResult`;
- overloaded trend `confidence` for ranking decisions;
- `scoreCandidate()` as combined thesis+contract authority;
- range60-as-position scoring behavior;
- exhaustive no-gate BPS/BCS/IC ranking path;
- mutable user rank weights if they conflict with validated/versioned score semantics;
- legacy traffic-light labels whose meaning is unsupported by calibration.

Retirement requires a separate final diff review because legacy Filter/Targeted scan modes may still depend on these contracts.

## 9. Implementation Stop Conditions

Dane must stop implementation and return to architecture/quant review if:

- authoritative point-in-time inputs required for a frozen contract are unavailable;
- historical option/event data cannot support the agreed validation target;
- existing scan modes require incompatible mutation of canonical contracts;
- implementation would require inventing thresholds/weights to proceed;
- a candidate contract attribute is required to decide thesis eligibility in a way that violates no-circular-eligibility;
- BPS/BCS/IC cannot be separated without changing Sponsor-approved semantics.

Routine file placement/refactoring decisions are not Sponsor blockers.

## 10. Readiness Ruling

The repository has a viable implementation seam. SQ-0001 can proceed as a staged dual-path implementation without rewriting Wheel/CSP/CC/PMCC and without immediately deleting the current Screener model.

**Dane status: IMPLEMENTATION SPECIFICATION COMPLETE.**

Next gate: Alan verifies architectural fidelity and Quinn verifies quantitative/testability fidelity. If both approve without a material contract change, implementation may proceed under the frozen specification.