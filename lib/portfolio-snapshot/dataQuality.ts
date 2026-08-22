// lib/portfolio-snapshot/dataQuality.ts
//
// LCC-0001A PR 2 — data-quality and fail-closed status construction. Implements
// docs/design/LCC-0001A-technical-spec.md §9.
//
// Generalizes lib/scans/covered-call-capacity.ts's buildCoveredCallCapacityReport() fail-closed
// contract (its "final corrective pass": an unattributable short option or working sell-to-open
// leg fails the ENTIRE report closed, not just the affected symbol) from
// "Covered Call scan unavailable" to snapshot-level. UNATTRIBUTABLE_EXPOSURE_REASON's successor
// string lives here as the single source of this exact wording, so the snapshot layer and any UI
// consumer never risk drifting out of sync on it -- same discipline as the source module's own
// exported constant.

import type { SnapshotDataQuality } from './types';
import type { ShortCallExposureResult } from './normalizeShortCallExposure';
import type { WorkingCallReservationResult } from './normalizeWorkingOrders';

export const UNATTRIBUTABLE_EXPOSURE_REASON =
  'Portfolio snapshot unavailable: open option exposure could not be matched to an underlying holding.';

export const ACCOUNT_UNRESOLVED_REASON =
  'Portfolio snapshot unavailable: account identity could not be resolved.';

export const POSITIONS_UNAVAILABLE_REASON =
  'Portfolio snapshot unavailable: broker positions could not be loaded.';

export const ORDERS_UNAVAILABLE_REASON =
  'Coverage-dependent capacity unavailable: complete order evidence could not be loaded.';

export const ADJUSTED_DELIVERABLE_REASON =
  'Coverage-dependent capacity unavailable: an adjusted or unresolved option deliverable was detected.';

/**
 * Builds the snapshot's dataQuality block once account identity, positions, and orders have each
 * either succeeded or failed, and once (if positions succeeded) the short-call/working-order
 * normalizers have run. Ordering of checks matches LCC-0001A technical spec §9's fail-closed
 * table:
 *   1. Account identity unresolved -> unavailable, before any per-symbol computation.
 *   2. Positions fetch failed -> unavailable; equities/options from a prior snapshot may still be
 *      shown by the caller, but this snapshot's own coverage-dependent fields are not computed.
 *   3. Unattributable short-option or working sell-to-open exposure -> unavailable, account-wide
 *      (ported verbatim from the source module's fail-closed behavior).
 *   4. Working orders fetch failed (positions succeeded) -> unavailable for coverage-dependent
 *      computation while reliable equity/option holdings remain present for display.
 *   5. Adjusted or unresolved option deliverables -> unavailable account-wide because standard
 *      100-share capacity math cannot safely represent them.
 */
export function buildDataQuality(input: {
  accountResolved: boolean;
  positionsLoaded: boolean;
  ordersLoaded: boolean;
  shortCallResult: ShortCallExposureResult | null; // null when positions failed to load
  workingCallResult: WorkingCallReservationResult | null; // null when orders failed to load
}): SnapshotDataQuality {
  const warnings: string[] = [];

  if (!input.accountResolved) {
    return { status: 'unavailable', unavailableReason: ACCOUNT_UNRESOLVED_REASON, staleQuotes: false, warnings };
  }

  if (!input.positionsLoaded) {
    return { status: 'unavailable', unavailableReason: POSITIONS_UNAVAILABLE_REASON, staleQuotes: false, warnings };
  }

  if (input.shortCallResult) {
    warnings.push(...input.shortCallResult.warnings);
  }
  if (input.workingCallResult) {
    warnings.push(...input.workingCallResult.warnings);
  }

  const hasUnattributableExposure =
    (input.shortCallResult?.hasUnattributableExposure ?? false) ||
    (input.workingCallResult?.hasUnattributableExposure ?? false);

  if (hasUnattributableExposure) {
    return { status: 'unavailable', unavailableReason: UNATTRIBUTABLE_EXPOSURE_REASON, staleQuotes: false, warnings };
  }

  const hasAdjustedDeliverable =
    (input.shortCallResult?.hasAdjustedOrUnknownDeliverable ?? false) ||
    (input.workingCallResult?.hasAdjustedOrUnknownDeliverable ?? false);
  if (hasAdjustedDeliverable) {
    return { status: 'unavailable', unavailableReason: ADJUSTED_DELIVERABLE_REASON, staleQuotes: false, warnings };
  }

  if (!input.ordersLoaded) {
    // Positions succeeded and carry no unattributable exposure on their own, but working-order
    // evidence is missing -- equities/options remain visible; coverage-dependent capacity figures
    // are not trustworthy. Holdings remain visible, but coverage-dependent capacity is unavailable.
    warnings.push(ORDERS_UNAVAILABLE_REASON);
    return { status: 'unavailable', unavailableReason: ORDERS_UNAVAILABLE_REASON, staleQuotes: false, warnings };
  }

  return { status: 'ok', staleQuotes: false, warnings };
}
