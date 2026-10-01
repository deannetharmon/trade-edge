# ADR — LEV-0001 Leveraged Instrument Metadata Boundary

**Status:** Accepted for LEV-0001 Gate 1
**Date:** 2026-10-01
**Issue:** #52

## Context

TradeEdge already carries broker-level instrument tokens (for example Equity Option / Index Option), option-leg `assetType`, and many strategy-local `underlyingSymbol` fields. None of these is a canonical economic classification for leveraged or inverse products. Code search found no existing `leverageMultiplier` domain contract.

LEV-0001 requires a validated relationship between the traded instrument and its economic underlying/benchmark without allowing individual scanners, React components, or AI to infer leverage from ticker naming.

## Decision

Create a reusable leveraged-instrument metadata domain boundary under `lib/instrument-metadata/`.

The domain contract distinguishes:
- product classification;
- economic underlying / benchmark;
- signed leverage multiplier;
- reset frequency;
- metadata provenance/freshness;
- normalization confidence.

This metadata is **not** the broker's option `instrument-type` and does not replace option-leg `assetType`.

Consumers (Decision Engine, Opportunity Engine, portfolio exposure, UI, AI) consume this canonical metadata rather than independently deriving product leverage.

Critical leveraged/inverse metadata is fail-closed. An instrument known to require normalization but lacking a validated underlying/benchmark, signed multiplier, or reset policy cannot receive authoritative normalized ranking.

Ticker patterns may be used only as non-authoritative discovery hints in future provider adapters; they may never produce `COMPLETE` normalization.

## Initial Contract

`InstrumentClassification`:
- COMMON_STOCK
- STANDARD_ETF
- LEVERAGED_ETF_ETP
- INVERSE_ETF_ETP
- LEVERAGED_INVERSE_ETF_ETP
- LEVERAGED_SINGLE_STOCK_ETF_ETP
- OTHER_LEVERAGED_PRODUCT
- UNKNOWN

`ResetFrequency`:
- DAILY
- MONTHLY
- OTHER
- NOT_APPLICABLE
- UNKNOWN

`NormalizationConfidence`:
- COMPLETE
- PARTIAL
- INCOMPLETE

The record carries symbol, classification, economicUnderlyingSymbol, benchmark, signedLeverageMultiplier, resetFrequency, provider/source identity, asOf timestamp, optional sourceUpdatedAt, and confidence/reasons.

## Consequences

- Existing broker/option models remain unchanged in Gate 1.
- LEV-0001 gets one canonical metadata shape for later risk/exposure integration.
- Provider-specific resolution is isolated behind a resolver interface.
- Missing/uncertain data remains explicit instead of receiving favorable defaults.
- Later gates can version risk calculations independently from metadata provenance.
