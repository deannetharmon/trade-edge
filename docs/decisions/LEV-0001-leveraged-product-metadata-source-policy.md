# LEV-0001 — Leveraged Product Metadata Source Policy

**Status:** Accepted for Gate 1
**Date:** 2026-10-01
**Issue:** #52

## Decision

Authoritative leveraged/inverse product economics are sourced from **issuer-published product data** (or a future normalized provider that demonstrably preserves equivalent issuer facts with provenance). Tastytrade remains the coarse tradability / stock-vs-ETF source; it is not treated as authoritative for leverage economics.

A product record may become `COMPLETE` only when the source explicitly establishes:
- exact traded ticker;
- leveraged/inverse classification;
- economic underlying or benchmark;
- signed daily target / leverage multiplier;
- reset period;
- source identity and observation timestamp.

Ticker-name inference is prohibited for authoritative classification.

## Source hierarchy

1. Issuer product page / issuer product guide / issuer prospectus data.
2. Future curated normalized feed with issuer-equivalent provenance and freshness controls.
3. Broker ETF flag: useful only for coarse ETF classification; insufficient for leverage economics.
4. Name/ticker heuristic: discovery hint only; never authoritative.

## Initial issuer adapters

Implement issuer adapters behind `InstrumentMetadataResolver`. Gate 1 begins with Direxion because its official single-stock product listing exposes ticker, benchmark/underlying and Daily Target in one issuer-maintained table. The architecture must be issuer-neutral; ProShares, GraniteShares, REX/T-REX and others plug into the same contract.

Do **not** scrape issuer sites at scan time. Runtime scanners consume a versioned/cached normalized catalog. Catalog refresh is an ingestion/maintenance concern, so an issuer-site outage cannot silently change scan classification.

## Freshness / failure

Every catalog entry records source URL/ID, issuer, `sourceUpdatedAt` when available, ingestion `asOf`, and confidence.

If an ETF is broker-confirmed but absent from authoritative catalog coverage, it remains `PARTIAL` rather than being declared standard 1x. If an entry is stale beyond configured policy or internally inconsistent, it is non-authoritative until refreshed/reconciled.

## Rationale

Leveraged products change: issuers launch/close funds, alter objectives, split shares, and can change names/tickers. The source policy therefore optimizes for explicit issuer facts, provenance, deterministic runtime behavior, and fail-closed handling rather than broad but unverifiable ticker heuristics.
