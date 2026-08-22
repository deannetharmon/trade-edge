// lib/portfolio-snapshot/acquire.ts
//
// LCC-0001A PR 2 — the single portfolio snapshot acquisition boundary. Implements
// docs/design/LCC-0001A-technical-spec.md §6, §9, §10.1.
//
// acquireSnapshot() is the only place in lib/portfolio-snapshot/ that touches raw broker
// payloads. It consumes acquirePortfolioBrokerSource(), then passes that exact source to the
// mature loadPositions() option adapter and every new normalizer. One /positions response and one
// /orders/live response therefore feed the complete snapshot; there is no parallel portfolio
// acquisition path.
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
 * options.acquireOptions is left undefined by default here; PR 2 does not populate the equity
 * quote-resolution path (currentPrice/marketValue/unrealizedPnl/quoteAsOf/staleQuote on
 * EquityHolding remain null/false, per normalizeEquity.ts's own PR 1 scope note) -- that wiring is
 * explicitly deferred, not silently attempted.
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
    },
    dataQuality: buildDataQuality({
      accountResolved,
      positionsLoaded: false,
      ordersLoaded: false,
      shortCallResult: null,
      workingCallResult: null,
    }),
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
  const ordersLoaded = rawOrders !== null;

  // Equity visibility does not depend on orders having loaded -- per LCC-0001A's own fail-closed
  // table, equities/options remain visible when only working-order evidence is missing.
  const equities = positionsLoaded
    ? normalizeEquityHoldings(rawPositions as RawPositionLike[], accountNumber)
    : [];

  const shortCallResult = positionsLoaded
    ? normalizeShortCallExposure(rawPositions as RawPositionLike[])
    : null;

  const workingCallResult = ordersLoaded
    ? normalizeWorkingCallReservations(rawOrders as RawOrderLike[])
    : null;

  const workingOrders = ordersLoaded
    ? normalizeWorkingOrders(rawOrders as RawOrderLike[], accountNumber)
    : [];

  const dataQuality = buildDataQuality({
    accountResolved: true,
    positionsLoaded,
    ordersLoaded,
    shortCallResult,
    workingCallResult,
  });

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
          !(workingCallResult?.hasUnattributableExposure ?? false),
        warnings: [...(shortCallResult?.warnings ?? []), ...(workingCallResult?.warnings ?? [])],
      },
      dataQuality,
    },
    pendingOrders: optionResult.pendingOrders,
  };
}

export async function acquireSnapshot(token?: string): Promise<PortfolioSnapshot> {
  return (await acquirePortfolioSnapshot(token)).snapshot;
}
