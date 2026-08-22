// lib/portfolio-snapshot/acquire.ts
//
// LCC-0001A PR 2 — the single portfolio snapshot acquisition boundary. Implements
// docs/design/LCC-0001A-technical-spec.md §6, §9, §10.1.
//
// acquireSnapshot() is the only place in lib/portfolio-snapshot/ that touches raw broker
// payloads. It consumes acquirePortfolioBrokerSource(), then passes that exact source to the
// mature loadPositions() option adapter and every new normalizer. One /positions response and one
// /orders/live response therefore feed the complete snapshot; there is no parallel portfolio
// acquisition path. Marked positions, live orders, and complex-order evidence are acquired once
// and passed into the mature adapter without re-fetching those endpoints.
//
// No consumer wiring beyond what PortfolioDataProvider.tsx needs to expose `snapshot`/
// `snapshotDataQuality` (see that file's changes, PR 2 scope). Screener is not touched.

import type { PendingOrder } from '@/lib/portfolio-data/types';
import {
  acquirePortfolioBrokerSource,
  loadPositions,
} from '@/lib/portfolio-data/acquisition';
import type { PortfolioSnapshot } from './types';
import { normalizeEquityHoldings, type RawPositionLike as RawEquityPositionLike } from './normalizeEquity';
import { normalizeShortCallExposure, type RawPositionLike as RawShortCallPositionLike } from './normalizeShortCallExposure';
import {
  normalizeWorkingOrders,
  normalizeWorkingCallReservations,
  type RawOrderLike,
} from './normalizeWorkingOrders';
import { buildDataQuality } from './dataQuality';

// Structural union of the raw position fields every normalizer in this module reads. A single
// fetch's raw items array satisfies all three normalizers' narrower RawPositionLike shapes.
type RawPositionLike = RawEquityPositionLike & RawShortCallPositionLike;

/**
 * LCC-0001A PR 2 feature flag. Gates whether PortfolioDataProvider acquires and exposes a
 * PortfolioSnapshot at all. Off by default -- reading process.env directly here (rather than
 * inventing a config module) since no existing feature-flag convention was found anywhere in this
 * repository at the time this ticket was implemented; this is a judgment call, see PR 2 report.
 * NEXT_PUBLIC_ prefix is required since this flag is read client-side (PortfolioDataProvider is a
 * 'use client' component).
 */
export const LCC_0001A_SNAPSHOT_ENABLED =
  process.env.NEXT_PUBLIC_LCC_0001A_SNAPSHOT_ENABLED === 'true';

/**
 * Acquires and normalizes one account-scoped PortfolioSnapshot. Never throws for expected
 * broker-availability failures (positions fail, orders fail, account unresolved) -- those become
 * dataQuality states, matching the existing acquisition.ts/covered-call-capacity.ts convention of
 * never letting an expected failure surface as an unhandled exception into UI code. Only a
 * genuinely unexpected error (e.g. getAccessToken() itself throwing "Not authenticated") propagates,
 * matching PortfolioDataProvider's existing refresh() error handling for Position[] today.
 *
 * Equity quote economics use only broker mark/close evidence carried by the canonical marked
 * positions response. Missing evidence remains null and stale; no price is fabricated.
 */
export interface PortfolioSnapshotAcquisition {
  snapshot: PortfolioSnapshot;
  pendingOrders: PendingOrder[];
}

function unavailableSnapshot(accountResolved: boolean): PortfolioSnapshot {
  return {
    accountNumber: '',
    asOf: new Date().toISOString(),
    quoteAsOf: null,
    equities: [],
    options: [],
    workingOrders: [],
    coverageEvidence: {
      existingShortCallsBySymbol: {},
      workingShortCallsBySymbol: {},
      unclassifiedSymbols: [],
      complete: false,
      warnings: [],
      hasAdjustedOrUnknownDeliverable: false,
    },
    dataQuality: buildDataQuality({
      accountResolved,
      positionsLoaded: false,
      ordersLoaded: false,
      shortCallResult: null,
      workingCallResult: null,
    }),
    freshness: 'current',
    lastSuccessfulAsOf: null,
  };
}

export async function acquirePortfolioSnapshot(token?: string): Promise<PortfolioSnapshotAcquisition> {
  let source;
  try {
    source = await acquirePortfolioBrokerSource(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (message === 'Not authenticated' || message === 'Session expired') throw error;
    return { snapshot: unavailableSnapshot(false), pendingOrders: [] };
  }

  const { accountNumber } = source;
  const asOf = new Date().toISOString();
  const rawPositions = source.rawPositions as RawPositionLike[] | null;
  const rawOrders = source.rawLiveOrders as RawOrderLike[] | null;

  const positionsLoaded = rawPositions !== null;
  const liveOrdersLoaded = rawOrders !== null;
  const ordersLoaded = liveOrdersLoaded && source.rawComplexOrders !== null;

  // Equity visibility does not depend on orders having loaded -- per LCC-0001A's own fail-closed
  // table, equities/options remain visible when only working-order evidence is missing.
  const equities = positionsLoaded
    ? normalizeEquityHoldings(rawPositions as RawPositionLike[], accountNumber)
    : [];

  const shortCallResult = positionsLoaded
    ? normalizeShortCallExposure(rawPositions as RawPositionLike[])
    : null;

  const workingCallResult = liveOrdersLoaded
    ? normalizeWorkingCallReservations(rawOrders as RawOrderLike[])
    : null;

  const workingOrders = liveOrdersLoaded
    ? normalizeWorkingOrders(rawOrders as RawOrderLike[], accountNumber)
    : [];

  const baseDataQuality = buildDataQuality({
    accountResolved: true,
    positionsLoaded,
    ordersLoaded,
    shortCallResult,
    workingCallResult,
  });
  const dataQuality = {
    ...baseDataQuality,
    staleQuotes: equities.some(holding => holding.staleQuote),
  };

  const optionResult = positionsLoaded
    ? await loadPositions(source)
    : { positions: [], pendingOrders: [] };

  return {
    snapshot: {
      accountNumber,
      asOf,
      quoteAsOf: null,
      equities,
      options: optionResult.positions,
      workingOrders,
      coverageEvidence: {
        existingShortCallsBySymbol: shortCallResult?.bySymbol ?? {},
        workingShortCallsBySymbol: workingCallResult?.bySymbol ?? {},
        unclassifiedSymbols: Array.from(new Set([
          ...Array.from(shortCallResult?.unclassifiedSymbols ?? []),
          ...Array.from(workingCallResult?.unclassifiedSymbols ?? []),
        ])),
        complete: positionsLoaded && ordersLoaded &&
          !(shortCallResult?.hasUnattributableExposure ?? false) &&
          !(workingCallResult?.hasUnattributableExposure ?? false) &&
          !(shortCallResult?.hasAdjustedOrUnknownDeliverable ?? false) &&
          !(workingCallResult?.hasAdjustedOrUnknownDeliverable ?? false),
        warnings: [...(shortCallResult?.warnings ?? []), ...(workingCallResult?.warnings ?? [])],
        hasAdjustedOrUnknownDeliverable:
          (shortCallResult?.hasAdjustedOrUnknownDeliverable ?? false) ||
          (workingCallResult?.hasAdjustedOrUnknownDeliverable ?? false),
      },
      dataQuality,
      freshness: 'current',
      lastSuccessfulAsOf: asOf,
    },
    pendingOrders: optionResult.pendingOrders,
  };
}

export async function acquireSnapshot(token?: string): Promise<PortfolioSnapshot> {
  return (await acquirePortfolioSnapshot(token)).snapshot;
}
