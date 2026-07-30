# SQ-0001A — Foundation Implementation Checkpoint

**Status:** FOUNDATION DECISION PATH ASSEMBLED — validation required before expansion

## Implemented on audit branch

The provider-neutral foundation now contains:

- point-in-time OHLC market-data contracts;
- corrected pure OHLC feature primitives;
- deterministic/versioned research horizon mapping;
- market-state evidence envelope;
- setup classification;
- point-in-time event-risk filtering using `knownAt`;
- independent BPS, BCS and IC thesis contracts;
- explicit IC upper/lower containment and weaker-side semantics;
- categorical eligibility gate;
- pure underlying orchestration across BPS/BCS/IC;
- immutable replay snapshot builder with anti-look-ahead guards.

## Architectural invariants now represented in code

1. Market-state evidence does not select an option strategy.
2. BPS, BCS and IC thesis evaluation occurs independently.
3. BCS is not implemented as a sign inversion of BPS.
4. IC has explicit two-sided containment state.
5. Contract economics are absent from strategy eligibility.
6. `INSUFFICIENT_EVIDENCE` is categorical.
7. Known binary events can block eligibility before contract ranking.
8. Event knowledge learned after T0 is excluded.
9. Model/config identity survives the decision trace.
10. The calculation path has no network/provider calls.

## Important limitation

The current market-state/setup/thesis classifications are foundation semantics used to exercise architecture and invariants. They are **not production-calibrated trading formulas** and must not replace the current authoritative Screener ranking yet.

In particular, current heuristic values in the foundation must be treated as provisional scaffolding until replay evidence determines appropriate feature definitions, thresholds and calibration.

## Next engineering gate

Before contract-ranking modules or Screener integration:

1. add targeted tests for feature semantics, event `knownAt`, BPS/BCS contradictory thesis, IC two-sided behavior, categorical insufficient evidence, and eligibility independence from contract economics;
2. run TypeScript validation against the branch;
3. correct any contract/type inconsistencies;
4. then design shadow capture and provider adapter integration.

No production score/threshold work is authorized at this checkpoint.