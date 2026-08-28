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
    expect(model.symbolGroups[0].symbolUnrealizedPnl).toBe(5200);
    expect(model.symbolGroups[0].unrealizedPnlMid.value).toBe(5200);
    expect(model.symbolGroups[0].optionCloseNowPnl.value).toBe(100);
    expect(model.symbolGroups[0].capacity).toMatchObject({ sharesOwned: 250, allocatedContracts: 1, availableContracts: 1, remainderShares: 50 });
  });

  it('preserves whole-position option value units and reports partial midpoint P/L honestly', () => {
    const priced = position({ key: 'AAPL-priced', currentValue: 760, pnl: 40, closeNowPnl: 35, quantity: 5 });
    const missing = position({ key: 'AAPL-missing', currentValue: null, pnl: null, closeNowPnl: null });
    const model = buildPositionsWorkspaceModel({ snapshot: snapshot([priced, missing]), positions: [priced, missing], pendingOrders: [], snapshotDataQuality: quality });
    const group = model.symbolGroups[0];
    expect(group.optionMarketValue).toBe(760);
    expect(group.unrealizedPnlMid).toMatchObject({ completeness: 'partial', includedCount: 2, expectedCount: 3, value: 5040 });
    expect(group.optionCloseNowPnl).toMatchObject({ completeness: 'partial', value: 35 });
  });

  it('fails capacity closed without hiding holdings', () => {
    const unavailable = { ...snapshot([]), dataQuality: { ...quality, status: 'unavailable' as const, unavailableReason: 'Working orders unavailable' } };
    const model = buildPositionsWorkspaceModel({ snapshot: unavailable, positions: [], pendingOrders: [], snapshotDataQuality: unavailable.dataQuality });
    expect(model.symbolGroups[0].equities).toHaveLength(1);
    expect(model.symbolGroups[0].capacity).toMatchObject({ status: 'unavailable', blockingReason: 'Working orders unavailable' });
    expect(model.symbolGroups[0].contextualAction).toBeNull();
  });

  it('derives portfolio-first PMCC and covered-call eligibility with exact evidence', () => {
    const heldLongCall = position({
      key: 'AAPL-long-call', accountNumber: 'fixture', expDate: '2027-06-18', dte: 295,
      legs: [{ symbol: 'AAPL  270618C00150000', optionType: 'C', strikePrice: 150, direction: 'Long', quantity: 1, avgOpenPrice: 20, currentPrice: 22 }],
    });
    const longPut = position({
      key: 'AAPL-long-put', accountNumber: 'fixture', expDate: '2027-06-18', dte: 295,
      legs: [{ symbol: 'AAPL  270618P00150000', optionType: 'P', strikePrice: 150, direction: 'Long', quantity: 1, avgOpenPrice: 20, currentPrice: 22 }],
    });
    const model = buildPositionsWorkspaceModel({ snapshot: snapshot([heldLongCall, longPut]), positions: [heldLongCall, longPut], pendingOrders: [], snapshotDataQuality: quality });
    expect(model.incomeOpportunities).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'pmcc-short-call', positionKey: 'AAPL-long-call', status: 'eligible', exactContract: 'AAPL  270618C00150000' }),
      expect.objectContaining({ kind: 'pmcc-short-call', positionKey: 'AAPL-long-put', status: 'not-eligible', reason: expect.stringContaining('long put') }),
      expect.objectContaining({ kind: 'covered-call', symbol: 'AAPL', status: 'eligible', sharesOwned: 250, allocatedContracts: 1, reservedContracts: 0, availableContracts: 1 }),
    ]));
  });

  it('shows unavailable income evaluation rather than treating missing snapshot evidence as empty holdings', () => {
    const heldLongCall = position({ key: 'AAPL-long-call', accountNumber: 'fixture', legs: [{ symbol: 'AAPL  270618C00150000', optionType: 'C', strikePrice: 150, direction: 'Long', quantity: 1, avgOpenPrice: 20, currentPrice: 22 }] });
    const model = buildPositionsWorkspaceModel({ snapshot: null, positions: [heldLongCall], pendingOrders: [], snapshotDataQuality: { status: 'unavailable', staleQuotes: false, warnings: [], unavailableReason: 'Portfolio snapshot unavailable' } });
    expect(model.incomeOpportunities).toEqual([expect.objectContaining({ kind: 'pmcc-short-call', status: 'unavailable', reason: expect.stringContaining('Current attributable') })]);
  });
});

describe('analysis controls', () => {
  it('defines fourteen columns without the obsolete movement column and protects identity', () => {
    expect(ANALYSIS_COLUMNS).toHaveLength(14);
    expect(columnsForView('full')).toHaveLength(14);
    expect(ANALYSIS_COLUMNS.map(column => column.id)).not.toContain('movement');
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

  it('silently migrates a saved movement column while retaining valid selections', () => {
    const decoded = decodePreferences(JSON.stringify({ version: 1, workspaceView: 'analysis', analysisView: 'custom', filters: {}, customColumnIds: ['identity', 'movement', 'pnl', 'orders'] }));
    expect(decoded.customColumnIds).toEqual(['identity', 'pnl', 'orders']);
  });
});
