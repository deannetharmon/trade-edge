// lib/scans/ccOrderSubmission.ts

// CC-ORDERS-0001 slice A: the gate every covered-call order passes. Same pattern as cspOrderSubmission.ts: the broker
// call is written AS the callback handed to submitCcOrderIfSafe, so there is no statement-level path to the broker
// that has not been through this gate. Coverage is read FRESH inside the gate (the caller passes a reader, not a
// report), so a result from when the dialog opened can never be what authorises the order.
//
// Fails closed: unknown, unavailable, stale-by-error or insufficient coverage means no order. Naked calls are never offered.

import { evaluateCoverage } from '@/lib/tradeLookup/coverage';
import type { CoverageReports } from '@/lib/tradeLookup/loadLookup';
import type { CoverageResult } from '@/lib/tradeLookup/lookupTypes';
import { computeCcAssignment, type CcAssignmentResult } from './ccOrderMath';

export interface CcOrderRequest {
  symbol: string;
  /** Expiration of the call being sold, 'YYYY-MM-DD'. */
  expiration: string;
  strike: number;
  quantity: number;
  entryPerShare: number;
  /** The trader acknowledged the below-cost-basis assignment note. */
  belowCostBasisAcknowledged: boolean;
}

export type CcOrderGuardResult =
  | { allowed: false; reason: string; coverage: CoverageResult | null }
  | { allowed: true; coverage: CoverageResult; assignment: CcAssignmentResult };

/**
 * Per-share broker cost basis for the symbol from a coverage reading, or null when the report is missing or the basis
 * is incomplete (some lot without a basis). Read from the SAME fresh reading that proves coverage.
 */
export function costBasisFromReports(reports: CoverageReports | null, symbol: string): number | null {
  if (!reports || !reports.capacity || reports.capacity.status !== 'ok') return null;
  const entry = reports.capacity.bySymbol[symbol.toUpperCase()];
  if (!entry || !entry.costBasisComplete || entry.costBasis === null || !(entry.costBasis > 0)) return null;
  return entry.costBasis;
}

/** Pure decision from reports that were just read. */
export function guardCcOrder(reports: CoverageReports | null, request: CcOrderRequest): CcOrderGuardResult {
  if (!Number.isInteger(request.quantity) || request.quantity < 1) {
    return { allowed: false, reason: 'Quantity must be a positive whole number.', coverage: null };
  }
  if (!Number.isFinite(request.entryPerShare) || request.entryPerShare <= 0) {
    return { allowed: false, reason: 'Enter a positive limit price.', coverage: null };
  }
  if (!Number.isFinite(request.strike) || request.strike <= 0) {
    return { allowed: false, reason: 'The strike is not valid.', coverage: null };
  }
  const coverage = evaluateCoverage({
    strategy: 'CC',
    symbol: request.symbol,
    contracts: request.quantity,
    expiration: request.expiration,
    capacity: reports ? reports.capacity : null,
    foundations: reports ? reports.foundations : null,
  });
  if (!coverage.canOrder) return { allowed: false, reason: coverage.message, coverage };

  const assignment = computeCcAssignment({
    strike: request.strike,
    creditPerShare: request.entryPerShare,
    costBasis: costBasisFromReports(reports, request.symbol),
    quantity: request.quantity,
  });
  if (assignment.belowCostBasis && !request.belowCostBasisAcknowledged) {
    return { allowed: false, reason: 'Acknowledge that assignment would sell your shares below your cost basis before placing this order.', coverage };
  }
  return { allowed: true, coverage, assignment };
}

export type SubmitCcOrderResult<T> =
  | { submitted: true; result: T; coverage: CoverageResult }
  | { submitted: false; reason: string };

/**
 * `readCoverage` is called here, immediately before the broker callback, to get a fresh reading. A reader that throws
 * is treated as "could not verify", never as "covered".
 */
export async function submitCcOrderIfSafe<T>(
  readCoverage: () => Promise<CoverageReports>,
  request: CcOrderRequest,
  submitToBroker: () => Promise<T>,
): Promise<SubmitCcOrderResult<T>> {
  let reports: CoverageReports | null = null;
  try {
    reports = await readCoverage();
  } catch {
    reports = null;
  }
  const guard = guardCcOrder(reports, request);
  if (!guard.allowed) return { submitted: false, reason: guard.reason };
  const result = await submitToBroker();
  return { submitted: true, result, coverage: guard.coverage };
}
