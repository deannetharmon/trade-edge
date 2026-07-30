# SQ-0001A — Historical Data Feasibility Audit

**Status:** COMPLETE — foundation implementation can proceed; retrospective contract calibration is data-constrained  
**Scope:** Determine whether TradeEdge's current repository/provider architecture can support the frozen SQ-0001 point-in-time validation contract.

## 1. Executive Ruling

TradeEdge currently has sufficient live/current data pathways to build the new pure decision foundation and begin prospective shadow capture, but the repository does **not** contain evidence of a historical point-in-time option-market dataset sufficient to retrospectively reconstruct BPS/BCS/IC candidate state with quotes, greeks, OI, IV/IVR and event knowledge at arbitrary historical T0 dates.

The existing Yahoo chart route supplies current-request historical daily OHLC for a rolling six-month window. That is adequate for market-state feature development and underlying-path outcome labeling inside the available window, but it is not by itself sufficient to reproduce historical option candidate economics.

Therefore SQ-0001A should proceed with pure contracts/features plus a versioned snapshot-capture seam. Production thesis/ranking calibration remains blocked until either:

1. an authoritative historical options/event source is identified/acquired; or
2. enough prospective TradeEdge snapshots are accumulated for empirical validation.

This is a quantitative data constraint, not an architecture failure.

## 2. Current Underlying Price Data

`app/api/chart/route.ts` currently requests Yahoo Finance:

- interval `1d`;
- range `6mo`;
- timestamps;
- open;
- high;
- low;
- close.

The route comment calls this OHLCV, but the implementation does **not** parse or return volume. That terminology should be corrected unless volume is deliberately added.

Bars with null OHLC fields are removed and the route returns `{t,o,h,l,c}`.

### Feasibility

This supports:

- true OHLC feature primitives;
- swing high/low calculations;
- gaps/candle bodies/wicks;
- range width and price-in-range position;
- moving-average/slopes where enough bars exist;
- retrospective underlying path labels for dates retained in the returned history.

It does not establish:

- more than the provider's requested rolling six-month history;
- point-in-time option market state;
- historical IVR as known at T0;
- historical event knowledge as known at T0.

## 3. Historical Option-State Requirement

The frozen validation contract requires, at historical T0:

- available expirations/strikes;
- bid/ask/mark or equivalent quote state;
- greeks including delta where used;
- open interest/liquidity evidence;
- IV/IVR evidence;
- candidate credit/debit/ROC inputs;
- earnings/event knowledge known at T0.

The audited repository contains live scan orchestration that fetches option chains/quotes/market metrics for the current scan, but no repository artifact was identified that persists a time-series of those complete scan inputs for arbitrary historical replay.

Consequently, a historical underlying chart cannot recreate what TradeEdge would actually have ranked at T0. Using today's chain/greeks/IVR for a past date would be look-ahead/temporal corruption and is prohibited.

## 4. Event Data

Current scan behavior has earnings metadata available in the live decision path, but the audit found no versioned historical event-knowledge ledger proving what earnings date/knowledge was available at each historical T0.

For replay, an event record needs at minimum:

- symbol;
- event type;
- event effective date/time;
- `knownAt` timestamp;
- source/version where relevant.

Without `knownAt`, a subsequently revised earnings calendar can leak future knowledge into historical decisions.

## 5. Outcome Labels Feasible from Underlying OHLC

Even before historical option snapshots exist, point-in-time OHLC can support research labels such as:

### BPS
- maximum adverse underlying excursion;
- underlying challenge/touch of a specified hypothetical short strike when that strike is supplied by a valid T0 snapshot;
- terminal relation to supplied strike;
- structural thesis-break labels based on frozen definitions.

### BCS
- maximum adverse upward excursion;
- challenge/touch of supplied short call strike;
- terminal relation;
- structural thesis-break labels.

### IC
- excursion toward upper/lower supplied boundaries;
- first boundary touch/break;
- terminal containment;
- side-specific underlying path behavior.

Actual spread P/L under a management policy requires historical option valuation or a defensible pricing reconstruction contract; underlying OHLC alone is insufficient for authoritative realized option P/L.

## 6. Data Classes and Feasibility

| Data class | Current/live path | Historical point-in-time replay evidence | SQ-0001A ruling |
|---|---|---|---|
| Daily OHLC | Yes | Rolling Yahoo history available on request | Proceed |
| Volume | Route claims OHLCV but does not return volume | Not established | Optional research; do not assume |
| Option chain/strikes | Live scan path | Complete historical snapshots not established | Capture/acquire required |
| Quotes | Live scan path | Historical snapshots not established | Capture/acquire required |
| Greeks/delta | Live scan path | Historical snapshots not established | Capture/acquire required |
| OI/liquidity | Live scan path | Historical snapshots not established | Capture/acquire required |
| IV/IVR | Live market metrics | Historical T0 series not established | Capture/acquire required |
| Earnings/event knowledge | Live metadata exists | `knownAt` historical ledger not established | Capture/acquire required |
| Underlying future path | Yahoo history | Available within requested history window | Proceed for path labels |
| Realized option P/L | Current portfolio/trade systems may contain individual outcomes | General historical candidate valuation dataset not established | Not authoritative for broad calibration |

## 7. Required Snapshot Contract

Every new shadow/live evaluation should be capable of persisting a replay snapshot containing:

```text
snapshotId
capturedAt
symbol
marketDataAsOf
OHLC history reference/payload
horizon + horizonVersion
eventRisk evidence + knownAt
option expirations/strikes considered
quotes/greeks/OI used
IV/IVR inputs
underlying classification inputs
modelVersion
configVersion
marketStateEvidence
setupClassification
strategyTheses
eligibility decisions
candidate inputs
contract rankings
decision trace
```

The snapshot must preserve raw inputs required to reproduce the decision, not only the final score.

## 8. Prospective Validation Path

While retrospective option data is unresolved, TradeEdge can begin accumulating its own authoritative dataset in shadow mode:

1. On each qualified Screener evaluation, capture the versioned point-in-time snapshot.
2. Do not alter authoritative user ranking based on the experimental model.
3. Later append outcome observations without mutating the T0 snapshot.
4. Evaluate BPS/BCS/IC separately by horizon/model version.
5. Use captured data to test eligibility coverage, strike challenges, adverse excursion, containment and ranking monotonicity.

This creates a clean first-party validation corpus even if an external historical options vendor is later added.

## 9. Retrospective Data Path

A separate investigation may evaluate historical option-data providers or existing broker/vendor capabilities. Any source must be assessed for:

- true historical quote/greek/OI availability;
- timestamp resolution;
- survivorship/adjustment behavior;
- historical IV/IVR reconstructability;
- event calendar point-in-time semantics;
- licensing/cost;
- ability to reproduce the exact fields TradeEdge uses.

No provider is selected by this audit.

## 10. Foundation Work Authorized by This Finding

Proceed now with:

- canonical decision and market-data types;
- accurate OHLC semantics;
- range width vs position correction in new primitives;
- actual lookback naming;
- pure feature calculations;
- deterministic horizon/version contracts;
- replay/snapshot interfaces;
- prospective capture seam design;
- invariant tests.

Do not proceed yet with production eligibility thresholds, ranking weights, probability calibration, or authoritative score labels.

## 11. Finding Register

- **DF-001 — High:** no demonstrated historical point-in-time option snapshot corpus for broad retrospective replay.
- **DF-002 — High:** historical earnings/event `knownAt` semantics are not established.
- **DF-003 — Medium:** chart route says OHLCV but returns OHLC only.
- **DF-004 — Medium:** six-month Yahoo request limits immediately available underlying research history unless expanded/versioned.
- **DF-005 — High:** authoritative realized spread P/L cannot be inferred from underlying OHLC alone.
- **DF-006 — Opportunity:** current live scan path can seed prospective versioned shadow snapshots immediately once capture infrastructure is authorized.

## 12. Conclusion

SQ-0001's architecture remains implementable. The immediate foundation does not depend on historical option data. Empirical promotion of the replacement ranking model does.

The correct implementation sequence is therefore:

**pure foundation -> snapshot capture -> retrospective source decision/prospective accumulation -> empirical thesis/ranking calibration -> promotion.**

**DATA FEASIBILITY AUDIT: COMPLETE.**