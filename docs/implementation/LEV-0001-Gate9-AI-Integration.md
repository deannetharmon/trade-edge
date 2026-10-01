# LEV-0001 Gate 9 — AI Integration Implementation

## Scope

Gate 9 supplies canonical structured leverage metadata to the AI-policy scan-summary and grounded-chat snapshots without extending the frozen legacy `/api/analyze` feature set.

## Implementation

- Added a server-derived leverage context builder backed only by the versioned issuer catalog.
- Scan snapshot candidates receive leverage classification, economic underlying, signed multiplier, reset frequency, metadata confidence/completeness, reset/path-risk state, and context/catalog versions when a catalog entry exists.
- Trade-level risk normalization is explicitly marked `NOT_PROVIDED_BY_SCAN_SNAPSHOT`; the AI is not allowed to turn metadata completeness into authoritative effective exposure, stress loss, or comparable risk.
- Unknown symbols receive no leverage context. No ticker-name inference is permitted.
- Scan prompt rules now explicitly prohibit inferring leverage, inverse direction, economic underlying, multiplier, or reset behavior from ticker spelling.
- Legacy `/api/analyze`, `/api/advisor`, and `/api/leaps-advisor` are unchanged, honoring AI-POLICY D2.

## Review findings

Ian: the context separates product metadata from trade-level normalized risk and preserves signed inverse direction.

Alan: the AI layer consumes canonical instrument metadata; it does not duplicate leverage classification logic or import AI policy into deterministic domains.

Quinn: tests cover catalog-confirmed leverage, inverse direction, spoofed client fields, registry coverage, and no-inference behavior for unknown symbols.

## Known boundary

The scan snapshot does not yet contain authoritative Gate 6 layered-option exposure/stress evidence. Gate 9 therefore fails closed at the AI boundary by declaring trade-level risk normalization unavailable rather than reconstructing or estimating it.
