# ADR — LEV-0001 Exposure and Risk Domain Boundary

**Status:** Accepted for Gate 2
**Date:** 2026-10-01
**Issue:** #52

## Decision

`lib/leverage-risk` owns economic-underlying exposure normalization and leverage-specific scenario primitives. It does not replace strategy-specific max-loss engines or the canonical Decision Engine.

### Responsibilities

Leverage-risk owns:
- initial underlying-equivalent exposure (UEE);
- capital-efficiency disclosure;
- same-economic-underlying gross/net aggregation;
- first-order underlying-move stress for simple long instruments;
- leverage-specific hard-gate evidence.

Existing strategy modules continue to own actual strategy max-loss/capital-at-risk calculations (CSP, spreads, LEAPS/PMCC, etc.).

The canonical Decision Engine remains the authority that turns evidence and configured policy into recommendation disposition. Gate 2 hard-gate functions are pure domain primitives intended to feed that authority in later integration; they are not a second recommendation engine.

## Semantic rules

- `normalizationAuthoritative` means the instrument metadata/exposure basis is sufficiently validated.
- `approximation: true` means the scenario method is simplified even when its inputs are authoritative.
- A simple long share/ETF position's maximum capital loss is capital deployed, not its UEE.
- Scenario stress loss is not expected loss, VaR, probability-weighted loss, or maximum loss.
- Gross exposure is never discarded merely because bearish and bullish exposure net down.
- Invalid/missing portfolio denominators fail percentage gates closed.
- Capital efficiency is informational and cannot itself improve recommendation disposition.

## Integration consequence

Later gates may add normalized evidence/concerns to `evaluateSingleCandidate()` and portfolio context. They must not bypass existing Decision Engine disposition or independently alter Opportunity Engine ranking after a canonical block.
