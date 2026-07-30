# SQ-0001 — Alan / Ian / Paul Challenge & Reconciliation

**Status:** COMPLETE — quantitative contract accepted with amendments  
**Reviewed input:** `SQ-0001-Quinn-Quantitative-Specification.md`  
**Purpose:** Challenge Quinn's quantitative contract from architecture, professional-trader, and product semantics perspectives, reconcile the findings, and establish the frozen input for Dane's implementation specification.

## 1. Team Ruling

Quinn's quantitative specification is accepted as the correct foundation. No architectural contradiction was found. The team requires the amendments below before implementation planning is considered frozen.

The amendments refine semantics and validation; they do not reopen the Sponsor-approved architecture.

## 2. Alan — Architecture Challenge

### A-1 — Preserve separation between market state and strategy thesis

Accepted. The common evidence model must not emit BPS/BCS/IC recommendations. It emits market facts/evidence. Strategy-specific thesis evaluators consume that evidence.

### A-2 — Expected move belongs at two different layers with different meanings

Quinn places expected-move relationship inside IC thesis evidence and expected-move clearance in contract ranking. This is valid only if the contracts distinguish them:

- thesis layer: market/volatility containment evidence independent of a particular candidate contract where possible;
- contract layer: actual short-strike clearance relative to expected move for that candidate.

The implementation specification must prevent circular eligibility where an attractive candidate strike itself makes the underlying thesis eligible.

### A-3 — Horizon must be an explicit input

Accepted. `SHORT`, `CORE`, `EXTENDED` are versioned research horizon classes, not hidden constants. Strategy thesis results must identify horizon and model version.

### A-4 — Replay is an architectural dependency, not a post-build utility

Accepted. Pure calculations and point-in-time inputs must be designed so the same decision path can run live or under replay. Live network access must not be embedded inside the authoritative calculation functions.

**Alan ruling: ACCEPT WITH A-2/A-4 explicit in implementation contract.**

## 3. Ian — Professional Trader Challenge

### I-1 — BPS/BCS thesis target should be strike-defense risk, not price direction

Accepted and reinforced. BPS can be valid in bullish-neutral conditions and BCS in bearish-neutral conditions. The primary thesis is whether the threatened side is sufficiently controlled over the trade horizon, not whether terminal price has the expected sign.

### I-2 — Touch and close outcomes are not interchangeable

Accepted. A spread can finish profitable after a severe short-strike challenge, and that path matters to a real trader. Touch/challenge, maximum adverse excursion, thesis break, terminal relation, and realized P/L remain separate labels.

### I-3 — IC requires two-sided evidence

Accepted and strengthened. IC eligibility requires affirmative evidence for both upper and lower containment. A strong lower boundary cannot compensate without limit for a weak upper boundary, or vice versa. The thesis result should expose side-specific containment evidence and the weaker side.

### I-4 — Reversal requires its own evidence class

Accepted. A reversal is not promoted to continuation merely because its directional score becomes strong. Setup class remains part of the thesis result and can have different eligibility/calibration.

### I-5 — Event risk must not be hidden in contract quality

Amendment required. Known earnings or equivalent binary events inside the relevant horizon can alter the underlying thesis/risk state, not merely candidate economics. The implementation contract must define an event-risk evidence field and allow strategy eligibility to reject/insufficient-evidence before contract ranking. Candidate-specific event handling may still exist downstream.

**Ian ruling: ACCEPT WITH event-risk amendment and explicit two-sided IC evidence.**

## 4. Paul — Product / Decision Semantics Challenge

### P-1 — Do not call an uncalibrated score confidence

Accepted. `confidence` is prohibited for the initial strategy ranking output unless it has a defined calibrated statistical meaning. Use terms such as `rankingScore` / `setupQualityScore` according to the final contract.

### P-2 — Eligibility and ranking must remain visible as different decisions

Accepted. A candidate cannot be shown as a normal ranked recommendation without a traceable eligible strategy thesis. Product output must preserve reason codes and supporting/contradicting evidence.

### P-3 — No authoritative Strong/A+ labels before validation

Accepted. Existing qualitative labels may remain only for legacy behavior while the replacement is non-authoritative. New model promotion requires Quinn's acceptance gates.

### P-4 — Insufficient evidence is not a weak score

Accepted. `INSUFFICIENT_EVIDENCE` is a decision state, not a low numeric ranking. It must not be sorted into the bottom of an otherwise eligible candidate list as if it were merely unattractive.

### P-5 — Cross-strategy scores remain non-comparable

Accepted. BPS 84, BCS 84, and IC 84 do not mean equivalent risk, probability, or expected return. The UI/data contract must retain strategy/model identity.

**Paul ruling: ACCEPT.**

## 5. Reconciled Amendments to Quinn Contract

The following are now binding implementation requirements:

1. **No circular thesis eligibility:** contract strike selection cannot manufacture underlying thesis eligibility.
2. **Pure decision path:** authoritative market-state, setup, thesis, eligibility, and ranking calculations accept point-in-time inputs; network acquisition is outside those pure functions.
3. **Event-risk evidence:** known binary-event risk relevant to the horizon is represented before strategy eligibility and can cause `INELIGIBLE` or `INSUFFICIENT_EVIDENCE`.
4. **IC side-specific containment:** upper and lower containment evidence are explicit; the weaker side is retained and validated.
5. **Path risk is first-class:** touch/challenge, adverse excursion, thesis break, terminal result, and realized P/L remain separate outcomes.
6. **No uncalibrated confidence terminology:** initial numeric model outputs are ranking/setup-quality scores only.
7. **Insufficient evidence is categorical:** it is never represented as merely a low score.
8. **Setup class survives downstream:** continuation/reversal/range/transition identity remains traceable through recommendation and replay.

## 6. Frozen Quantitative Contract for Implementation Planning

Dane may now design implementation around these authoritative concepts:

```text
PointInTimeMarketData
MarketStateEvidence
DecisionHorizon
SetupClassification
EventRiskEvidence
StrategyThesis<BPS | BCS | IC>
EligibilityDecision
ContractCandidate
ContractRanking
DecisionTrace
ModelVersion / ConfigVersion
ReplayRecord
OutcomeLabels
```

For IC, `StrategyThesis<IC>` must include upper containment, lower containment, and weaker-side evidence.

For BPS/BCS, thesis evidence is threatened-side control over the horizon, not terminal directional prediction alone.

## 7. Items Still Deliberately Not Frozen

Dane must not invent these during implementation:

- production feature weights;
- production thresholds;
- permanent DTE bucket boundaries;
- statistical/ML model choice;
- probability calibration;
- Strong/A+/win-rate labels;
- CSP/CC/Wheel/PMCC behavior beyond extension contracts.

These require empirical replay evidence or a later authorized work package.

## 8. Team Agreement

- **Alan:** APPROVED with architectural amendments incorporated.
- **Ian:** APPROVED with trader-risk amendments incorporated.
- **Paul:** APPROVED with semantic amendments incorporated.
- **Quinn contract:** ACCEPTED AS AMENDED.

**Result: SQ-0001 quantitative contract is FROZEN FOR IMPLEMENTATION SPECIFICATION.**

Dane's next deliverable is the complete implementation specification/file manifest and validation sequence. No production scoring formula is authorized by this freeze.