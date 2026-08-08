# SQ-0001A — tastytrade Historical Field Proof

**Status:** COMPLETE — official API surface verified; raw historical option-state sufficiency NOT proven  
**Purpose:** Determine whether tastytrade can satisfy SQ-0001's point-in-time replay/calibration requirements before TradeEdge evaluates another historical-options provider.

## 1. Ruling

The official tastytrade API materially improves TradeEdge's validation options, but the currently documented public API does not prove that TradeEdge can request an arbitrary historical option chain snapshot containing all raw fields required by the frozen replay contract.

Verified capabilities:

- current option-chain instrument structure;
- current/live quote path through market data/DXLink;
- historical corporate-event endpoints for earnings/dividends;
- a dedicated Backtester Backend API with available historical dates, backtest execution, logs/results, and simulate-trade;
- backtester schemas including Snapshot, Trial, Leg, EntryConditions, and ExitConditions.

Not proven from the public documentation inspected:

- arbitrary historical bid/ask snapshots for every option candidate at T0;
- arbitrary historical Greeks/delta at T0;
- arbitrary historical open interest/liquidity at T0;
- historical IV/IVR values exactly as TradeEdge would have observed them at T0;
- complete historical chain membership exposed as raw data at arbitrary T0;
- a corporate-event `knownAt` timestamp proving when a historical earnings date became known/revised.

Therefore tastytrade remains the first-choice path to investigate, but SQ-0001 must distinguish **backtest/simulation sufficiency** from **raw replay sufficiency**.

## 2. Current Chain / Live Market Data

Official tastytrade documentation exposes equity option chains through endpoints including nested and detailed chain forms. The chain supplies expirations, strikes, option symbols, and streamer symbols.

For pricing, tastytrade documentation directs clients to live quote/trade data through DXLink rather than deprecated position mark fields.

Ruling: strong support for prospective TradeEdge snapshot capture. This does not by itself establish historical T0 quote/Greek/OI retrieval.

## 3. Backtesting API

The official Backtester Backend API exposes:

- `GET /backtests`
- `POST /backtests`
- `GET /backtests/{id}`
- `GET /backtests/{id}/logs`
- `POST /backtests/{id}/cancel`
- `GET /available-dates`
- `POST /simulate-trade`

Published schemas include `BacktestPost`, `BacktestGet`, `Snapshot`, `Trial`, `Leg`, `EntryConditions`, `ExitConditions`, and `AvailableSymbolDates`.

This proves tastytrade possesses a historical simulation capability and symbol/date availability model.

It does **not**, from the documentation inspected, prove that the API exposes the full raw historical option surface needed to run TradeEdge's own candidate-generation and ranking logic exactly as if it were T0.

## 4. Two Validation Modes

### Mode A — Raw TradeEdge replay

Goal: reconstruct exactly what TradeEdge knew and could choose at T0.

Needs raw T0 data:

- chain membership;
- strikes/expirations;
- quotes;
- Greeks/delta;
- OI/liquidity;
- IV/IVR;
- event knowledge;
- underlying market data.

Status with tastytrade public docs: **NOT YET PROVEN**.

### Mode B — tastytrade simulation/backtest validation

Goal: test specified option strategy/trade rules against tastytrade's historical simulation engine.

Potential use:

- validate outcome behavior of specified BPS/BCS/IC constructions;
- compare strategy rules over available historical dates;
- test entry/exit policies;
- obtain independent historical outcome evidence even when raw historical market fields are not exposed.

Status: **SUPPORTED IN PRINCIPLE**, subject to endpoint/schema experiments and confirmation of what snapshots/results contain.

Mode B can be valuable, but it cannot automatically replace Mode A. If TradeEdge's model selects candidates using historical delta/OI/IVR and tastytrade does not expose those T0 inputs, TradeEdge cannot claim exact historical replay of its own ranking decision.

## 5. Corporate Events

Official Market Metrics documentation exposes:

- historic dividends by symbol;
- historic earnings reports by symbol.

This supports event-history research.

Still unresolved: whether the historical record includes point-in-time knowledge semantics sufficient to answer, 'What earnings date did TradeEdge know on T0?' A final event date stored today is not equivalent to a `knownAt` ledger if dates were announced or revised later.

## 6. Field Matrix

| SQ-0001 field | tastytrade capability verified | Historical T0 raw field proven? | Ruling |
|---|---|---|---|
| Option expirations/strikes | Current chain endpoints | No | Prospective yes; retrospective verify |
| Bid/ask/price | Live DXLink/market data | No | Prospective yes; retrospective verify |
| Delta/Greeks | Used in current TradeEdge live provider path | No public historical proof in this audit | Verify |
| Open interest | Current/live provider ecosystem | No public historical proof in this audit | Verify |
| IV/IVR | Market metrics/live path | No historical T0 proof | Verify/reconstruct if valid |
| Historical dates | Backtester `available-dates` | Yes, date availability concept | Useful |
| Historical simulation | Backtests + simulate-trade | Yes | High-value validation path |
| Historical earnings reports | Market Metrics endpoint | Yes | Useful, but `knownAt` unresolved |
| Event `knownAt` | Not established | No | Requires proof or first-party capture |
| Raw replay snapshot | Snapshot schema exists in backtester | Full required contents not established | Experiment required |

## 7. Required API Proof Spike

Before selecting another vendor, run authenticated experiments against tastytrade with a small symbol/date matrix (for example SPY plus several liquid equities across different dates).

For each historical date:

1. Query `available-dates` and document coverage.
2. Run a minimal backtest and inspect returned backtest object, logs, trials, and snapshots.
3. Run `simulate-trade` for a known BPS, BCS, and IC construction.
4. Record every historical field returned by Snapshot/Trial/Leg results.
5. Determine whether historical strike selection can be expressed by delta/DTE or only by preselected contracts/rules.
6. Determine whether historical bid/ask, delta, Greeks, OI, IV and underlying values are directly returned, internally usable only, or absent.
7. Query historical earnings for the same symbols/dates and inspect timestamp/revision semantics.
8. Compare tastytrade simulation outputs with a known real historical trade where TradeEdge/account history has a reliable execution/outcome.

Do not infer undocumented fields from schema names.

## 8. Architecture Consequence

No architecture change is required.

TradeEdge keeps provider-neutral contracts:

```text
HistoricalMarketDataProvider
HistoricalOptionStateProvider
HistoricalEventProvider
StrategySimulationProvider
```

A tastytrade adapter may implement one or more of these interfaces. This prevents tastytrade's backtester semantics from becoming TradeEdge's decision semantics.

## 9. Development Consequence

SQ-0001A foundation work can continue in parallel with the authenticated proof spike:

- canonical types;
- OHLC feature primitives;
- horizon/version contracts;
- replay interfaces;
- prospective snapshot capture seam;
- provider interfaces;
- invariant tests.

Production BPS/BCS/IC formula calibration remains gated on evidence, not on completion of these foundation modules.

## 10. Final Ruling

**tastytrade should be exhausted before TradeEdge evaluates another historical-options vendor.**

The Backtesting API is sufficiently promising that it may supply much or most of the historical validation capability. But the public documentation inspected does not justify claiming that raw historical chain/quote/Greek/OI/IVR replay is already solved.

Next technical action: authenticated field-level proof against Backtesting + Market Metrics APIs while SQ-0001A pure foundation implementation proceeds independently.