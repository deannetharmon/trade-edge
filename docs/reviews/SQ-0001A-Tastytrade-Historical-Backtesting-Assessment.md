# SQ-0001A — tastytrade Historical / Backtesting Assessment

**Status:** COMPLETE — tastytrade is a first-class candidate for retrospective validation, but raw T0 field completeness is not yet proven  
**Date:** 2026-07-30

## 1. Ruling

tastytrade materially changes the SQ-0001A data-feasibility picture.

Its current public developer surface includes a dedicated options Backtester Backend API with:

- `GET /available-dates`;
- `POST /backtests`;
- `GET /backtests/{id}`;
- `GET /backtests/{id}/logs`;
- `POST /simulate-trade`;
- schemas including `Snapshot`, `Trial`, `Leg`, `EntryConditions`, `ExitConditions`, and `AvailableSymbolDates`.

Its Market Metrics API also exposes historical corporate-event endpoints for dividends and earnings reports.

Its normal instruments/market-data path exposes current option-chain structure and directs applications to DXLink live quote data for pricing.

Therefore the earlier statement that retrospective calibration requires either a separate historical-data vendor or months of prospective accumulation is too strong. The correct statement is:

> TradeEdge does not itself persist the required historical option-state corpus, but tastytrade may provide enough historical/backtesting capability to support a substantial portion—or potentially all—of the retrospective validation workflow. Field-level proof is required before treating it as the authoritative replay source.

## 2. What Is Confirmed from Public Documentation

### Backtesting capability

Confirmed API surface includes available historical dates, backtest creation/results/logs, and direct trade simulation.

This establishes that tastytrade has an internal historical options backtesting data capability exposed through its API.

### Historical earnings/dividends

Confirmed Market Metrics endpoints include historical corporate events for earnings reports and dividends.

This is relevant to event-risk validation, although endpoint existence alone does not prove that every record exposes a `knownAt` timestamp representing what the market/user knew at historical T0.

### Current option-chain / market-data capability

Confirmed normal API capability includes equity option chains with expirations, strikes and streamer symbols. tastytrade documentation directs clients to DXLink live Trade/Quote events for up-to-date pricing.

This supports the live/prospective snapshot side of SQ-0001A.

## 3. What Is NOT Yet Proven

The public documentation discovered in this assessment does not by itself establish that the backtesting/simulation response exposes every raw T0 field required by the frozen TradeEdge replay contract.

Still to prove experimentally or from detailed schemas:

- historical bid/ask at the exact evaluation timestamp;
- historical delta and other Greeks at T0;
- historical open interest at T0;
- historical IV and/or sufficient inputs to reconstruct IV;
- historical IV Rank as known at T0;
- complete option-chain membership/strike availability at T0;
- timestamp granularity of historical snapshots;
- whether backtester `Snapshot` contains raw market state or only simulation outputs;
- whether earnings history exposes point-in-time `knownAt` semantics versus a current historical record;
- whether backtester data can be used to evaluate arbitrary TradeEdge-generated candidates rather than only tastytrade-defined strategy simulations;
- licensing/rate-limit/retention constraints for bulk research use.

## 4. Architectural Consequence

Do not make TradeEdge's canonical replay model depend directly on tastytrade-specific response shapes.

Maintain the approved provider-neutral contracts:

```text
PointInTimeMarketData
HistoricalOptionState
EventRiskEvidence
ReplaySnapshot
OutcomeLabels
```

Then implement tastytrade as an adapter/source if the field-level proof succeeds.

This preserves the ability to combine:

- tastytrade backtesting/simulation;
- tastytrade live DXLink snapshots;
- Yahoo or another OHLC source;
- a future specialist historical-options source;
- TradeEdge's own prospective snapshot corpus.

## 5. Recommended Proof Spike

Before selecting another historical-options vendor, execute a narrow tastytrade proof using representative symbols and dates.

For each of BPS, BCS and IC, determine whether the API can reconstruct or simulate a candidate at historical T0 and return enough information to calculate/validate:

- eligible expirations and strikes;
- entry economics;
- threatened short strike(s);
- subsequent touch/challenge;
- exit/expiration outcome under a fixed management rule;
- adverse path behavior;
- event proximity.

Separately test whether raw Greeks/OI/IV are exposed historically. If they are not, distinguish between:

1. fields needed to **replay the exact current TradeEdge model**; and
2. fields needed to **validate the new thesis/eligibility model and candidate outcomes**.

The backtesting API may still be highly valuable even if it does not expose every raw historical quote field.

## 6. Updated Data Strategy

SQ-0001A data strategy becomes:

1. Build provider-neutral pure decision/replay contracts.
2. Continue prospective versioned TradeEdge snapshot design.
3. Run tastytrade historical/backtesting proof before shopping for another provider.
4. If tastytrade satisfies the validation contract, use it as the primary retrospective source/engine.
5. If it partially satisfies the contract, use it for the proven outcomes and supplement only the missing data classes.
6. Use prospective first-party snapshots regardless, because they preserve exactly what TradeEdge knew and decided under each model version.

## 7. Team Ruling

**Alan:** No architecture change. Provider-neutral adapter boundary remains correct.

**Quinn:** Historical-data blocker is downgraded from presumed external-data requirement to **field-verification pending**. No production calibration until field-level proof is complete.

**Ian:** Backtester is potentially valuable for comparing real strategy outcomes, but path-risk metrics such as strike touch and adverse excursion must remain visible; win/loss alone is insufficient.

**Paul:** Do not expose backtest-derived probability/strength claims until the exact historical target and sample are defined and validated.

## 8. Conclusion

tastytrade should be investigated **before TradeEdge commits to another historical-options data provider**.

It is now the preferred first retrospective-validation candidate because TradeEdge already depends on tastytrade concepts and the current public API explicitly exposes options backtesting and historical corporate-event capabilities.

**TASTYTRADE ASSESSMENT: PROCEED TO FIELD-LEVEL PROOF.**