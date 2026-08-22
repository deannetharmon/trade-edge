// lib/portfolio-snapshot/capacity.ts
//
// LCC-0001A PR 2 — coverage-capacity calculations. Implements
// docs/design/LCC-0001A-technical-spec.md §8.
//
// computeCoveredCallCapacity() is ported UNCHANGED from lib/scans/covered-call-capacity.ts (lines
// 320-338 at the time this ticket was specified) -- the Math.floor(sharesOwned / 100) gross
// capacity formula, the Math.max(0, rawAvailable) clamp, and oversubscribed/hasUnclassifiedExposure
// diagnostics are correct as written and require no LCC-0001A changes.
//
// buildSnapshotCapacityReport() is the LCC-0001A-scoped equivalent of
// buildCoveredCallCapacityReport(), refactored (not rewritten) to operate on the already-normalized
// EquityHolding[]/ShortCallExposureResult/WorkingCallReservationResult a PortfolioSnapshot's
// acquisition already computed once, rather than re-deriving them from raw payloads. LCC-0001B's
// durable coverage allocations (active/proposed relationships) are explicitly NOT computed here --
// this remains the "existing conservative capacity logic" the LCC-0001A ticket text allows.

import type { EquityHolding, PortfolioSnapshot } from './types';

export interface CoveredCallCapacity {
  sharesOwned: number;
  costBasis: number | null;
  // Surfaces the completeness gate from EquityHolding.basisComplete so callers never have to
  // re-derive "is this basis trustworthy" themselves -- costBasis is already null whenever this is
  // false, but the explicit flag makes the reason legible rather than implicit.
  costBasisComplete: boolean;
  grossCoveredContracts: number;
  existingShortCallContracts: number;
  workingShortCallContracts: number;
  availableCoveredContracts: number; // clamped to >= 0
  oversubscribed: boolean; // true when existing + working exceeds gross capacity
  // True when at least one existing short option position or working sell-to-open leg for this
  // symbol could not be classified as call/put. The exposure IS already conservatively folded into
  // existingShortCallContracts/workingShortCallContracts above -- this flag is diagnostic, so
  // callers can warn "some positions could not be fully verified" rather than silently presenting
  // availableCoveredContracts as a fully-confirmed number.
  hasUnclassifiedExposure: boolean;
}

export function computeCoveredCallCapacity(
  sharesOwned: number,
  existingShortCallContracts: number,
  workingShortCallContracts: number,
  costBasis: number | null = null,
  costBasisComplete: boolean = costBasis != null,
  hasUnclassifiedExposure: boolean = false,
): CoveredCallCapacity {
  const grossCoveredContracts = Math.floor(Math.max(0, sharesOwned) / 100);
  const rawAvailable = grossCoveredContracts - existingShortCallContracts - workingShortCallContracts;

  return {
    sharesOwned,
    costBasis,
    costBasisComplete,
    grossCoveredContracts,
    existingShortCallContracts,
    workingShortCallContracts,
    availableCoveredContracts: Math.max(0, rawAvailable),
    oversubscribed: rawAvailable < 0,
    hasUnclassifiedExposure,
  };
}

export interface SnapshotCapacityReport {
  status: 'ok' | 'unavailable';
  bySymbol: Record<string, CoveredCallCapacity>;
  warnings: string[];
  unavailableReason?: string;
}

/**
 * Combines already-normalized equity holdings, short-call exposure, and working-order reservation
 * results into a per-symbol capacity map. Only Long equity holdings contribute gross capacity --
 * Short holdings (retained and visible per LCC-0001A's own EquityHolding shape) are excluded here,
 * satisfying epic invariant 2 ("short stock never provides covered-call support").
 *
 * Unlike the pre-LCC-0001 buildCoveredCallCapacityReport(), this function does not itself decide
 * account-wide unavailability -- that fail-closed decision is made once, before this function is
 * called, by dataQuality.ts, using the same shortCallResult/workingCallResult inputs. This function
 * assumes it is only ever called once that gate has already passed.
 */
function buildCapacityFromNormalized(
  equities: EquityHolding[],
  existingShortCallsBySymbol: Record<string, number>,
  workingShortCallsBySymbol: Record<string, number>,
  unclassifiedSymbols: Set<string>,
): Record<string, CoveredCallCapacity> {
  const holdingsBySymbol: Record<string, EquityHolding> = {};
  for (const holding of equities) {
    if (holding.direction !== 'Long') continue; // short stock never contributes capacity
    // If multiple Long holdings somehow exist for the same symbol (should not happen given
    // normalizeEquityHoldings' own symbol+direction grouping, but defensively handled here rather
    // than assumed), the later one wins -- there is exactly one Long EquityHolding per symbol from
    // normalizeEquityHoldings() as written.
    holdingsBySymbol[holding.symbol] = holding;
  }

  const shortCalls = existingShortCallsBySymbol;
  const workingCalls = workingShortCallsBySymbol;

  const symbols = new Set([
    ...Object.keys(holdingsBySymbol),
    ...Object.keys(shortCalls),
    ...Object.keys(workingCalls),
  ]);
  const bySymbol: Record<string, CoveredCallCapacity> = {};

  for (const symbol of Array.from(symbols)) {
    const holding = holdingsBySymbol[symbol];
    const hasUnclassifiedExposure = unclassifiedSymbols.has(symbol);
    bySymbol[symbol] = computeCoveredCallCapacity(
      holding?.quantity ?? 0,
      shortCalls[symbol] ?? 0,
      workingCalls[symbol] ?? 0,
      holding?.basis ?? null,
      holding?.basisComplete ?? false,
      hasUnclassifiedExposure,
    );
  }

  return bySymbol;
}

/**
 * Public capacity boundary. Consumers provide the canonical snapshot, never
 * parallel arrays reconstructed from another acquisition path.
 */
export function buildSnapshotCapacityReport(snapshot: PortfolioSnapshot): SnapshotCapacityReport {
  if (snapshot.dataQuality.status === 'unavailable') {
    return {
      status: 'unavailable',
      bySymbol: {},
      warnings: snapshot.dataQuality.warnings,
      unavailableReason: snapshot.dataQuality.unavailableReason,
    };
  }

  if (!snapshot.coverageEvidence.complete) {
    return {
      status: 'unavailable',
      bySymbol: {},
      warnings: snapshot.coverageEvidence.warnings,
      unavailableReason: snapshot.dataQuality.unavailableReason,
    };
  }

  return {
    status: 'ok',
    bySymbol: buildCapacityFromNormalized(
      snapshot.equities,
      snapshot.coverageEvidence.existingShortCallsBySymbol,
      snapshot.coverageEvidence.workingShortCallsBySymbol,
      new Set(snapshot.coverageEvidence.unclassifiedSymbols),
    ),
    warnings: snapshot.dataQuality.warnings,
  };
}
