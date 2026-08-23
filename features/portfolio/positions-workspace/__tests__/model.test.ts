import { describe, expect, it } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';
import type { PortfolioSnapshot, SnapshotDataQuality } from '@/lib/portfolio-snapshot/types';
import { buildPositionsWorkspaceModel } from '../model/buildPositionsWorkspaceModel';
import { ANALYSIS_COLUMNS, columnsForView, sanitizeColumns } from '../model/columns';
import { activeFilterCount, matchesAnalysisFilters } from '../model/filters';
import { decodePreferences } from '../model/preferences';

const quality: SnapshotDataQuality = { status: 'ok', staleQuotes: false, warnings: [] };
const position = (overrides: Partial<Position> = {}): Position => ({
  key: 'AAPL-1', symbol: 'AAPL', strategy: 'CSP', closeNowPnl: 125, pnl: 100,
  needsClose: false, structureAmbiguous: false, recommendation: undefined,
  currentValue: 1.5, quantity: 1,
  ...overrides,
} as Position);

const snapshot = (options: Position[]): PortfolioSnapshot => ({
  accountNumber: 'fixture', asOf: '2026-08-23T12:00:00Z', quoteAsOf: '2026-08-23T11:59:00Z',
  equities: [{ accountNumber: 'fixture', symbol: 'AAPL', direction: 'Long', quantity: 250, settledQuantity: null, basis: 150, basisComplete: true, currentPrice: 200, marketValue: 50000, unrealizedPnl: 5000, quoteAsOf: null, staleQuote: false, deliverable: 'standard', dataQualityWarnings: [] }],
  options, workingOrders: [], freshness: 'current', lastSuccessfulAsOf: '2026-08-23T12:00:00Z', dataQuality: quality,
  coverageEvidence: { existingShortCallsBySymbol: { AAPL: 1 }, workingShortCallsBySymbol: {}, unclassifiedSymbols: [], complete: true, warnings: [], hasAdjustedOrUnknownDeliverable: false },
});

describe('positions workspace model', () => {
  it('groups stably and counts each instrument P/L once', () => {
    const first = position();
    const second = position({ key: 'AAPL-2', closeNowPnl: -25 });
    const model = buildPositionsWorkspaceModel({ snapshot: snapshot([second, first]), positions: [second, first], pendingOrders: [], snapshotDataQuality: quality });
    expect(model.symbolGroups.map(group => group.symbol)).toEqual(['AAPL']);
    expect(model.symbolGroups[0].instrumentCount).toBe(3);
    expect(model.symbolGroups[0].symbolUnrealizedPnl).toBe(5100);
    expect(model.symbolGroups[0].capacity).toMatchObject({ sharesOwned: 250, allocatedContracts: 1, availableContracts: 1, remainderShares: 50 });
  });

  it('fails capacity closed without hiding holdings', () => {
    const unavailable = { ...snapshot([]), dataQuality: { ...quality, status: 'unavailable' as const, unavailableReason: 'Working orders unavailable' } };
    const model = buildPositionsWorkspaceModel({ snapshot: unavailable, positions: [], pendingOrders: [], snapshotDataQuality: unavailable.dataQuality });
    expect(model.symbolGroups[0].equities).toHaveLength(1);
    expect(model.symbolGroups[0].capacity).toMatchObject({ status: 'unavailable', blockingReason: 'Working orders unavailable' });
    expect(model.symbolGroups[0].contextualAction).toBeNull();
  });
});

describe('analysis controls', () => {
  it('defines all fourteen columns and protects identity', () => {
    expect(ANALYSIS_COLUMNS).toHaveLength(14);
    expect(columnsForView('full')).toHaveLength(14);
    expect(sanitizeColumns(['pnl'])).toEqual(['identity', 'pnl']);
  });

  it('counts and applies filters without changing the row model', () => {
    const filters = { symbol: 'aap', strategy: 'csp', attention: 'monitoring' as const, pnl: 'positive' as const };
    expect(activeFilterCount(filters)).toBe(4);
    expect(matchesAnalysisFilters({ id: '1', position: position(), symbol: 'AAPL', strategy: 'CSP', needsAttention: false }, filters)).toBe(true);
  });

  it('rejects malformed and future preference payloads', () => {
    expect(decodePreferences('{')).toMatchObject({ version: 1, workspaceView: 'portfolio' });
    expect(decodePreferences(JSON.stringify({ version: 2, workspaceView: 'analysis' }))).toMatchObject({ version: 1, workspaceView: 'portfolio' });
    const decoded = decodePreferences(JSON.stringify({ version: 1, workspaceView: 'analysis', analysisView: 'custom', filters: { symbol: 'AAPL', unknown: true }, customColumnIds: ['identity', 'pnl', 'future'] }));
    expect(decoded).toMatchObject({ workspaceView: 'analysis', analysisView: 'custom', filters: { symbol: 'AAPL', strategy: '', attention: 'all', pnl: 'all' }, customColumnIds: ['identity', 'pnl'] });
  });
});
