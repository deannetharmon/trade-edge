import { describe, expect, it, vi } from 'vitest';
import type { CoveredCallCapacityReport } from '@/lib/scans/covered-call-capacity';
import type { PortfolioSnapshot } from '../types';
import {
  CC_CAPACITY_SHADOW_EVENT,
  compareCoveredCallCapacityShadow,
  emitCoveredCallCapacityShadow,
  isCcCapacityShadowEnabled,
} from '../shadowParity';

const capacity = (overrides = {}) => ({
  sharesOwned: 200,
  costBasis: 50,
  costBasisComplete: true,
  grossCoveredContracts: 2,
  existingShortCallContracts: 1,
  workingShortCallContracts: 0,
  availableCoveredContracts: 1,
  oversubscribed: false,
  hasUnclassifiedExposure: false,
  ...overrides,
});

const legacy = (overrides: Partial<CoveredCallCapacityReport> = {}): CoveredCallCapacityReport => ({
  status: 'ok', bySymbol: { AAPL: capacity() }, warnings: [], ...overrides,
});

const snapshot = (overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot => ({
  accountNumber: 'SECRET-ACCOUNT-123',
  asOf: '2026-08-22T18:00:00.000Z',
  quoteAsOf: null,
  equities: [{
    accountNumber: 'SECRET-ACCOUNT-123', symbol: 'AAPL', direction: 'Long', quantity: 200,
    settledQuantity: null, basis: 50, basisComplete: true, currentPrice: null, marketValue: null,
    unrealizedPnl: null, quoteAsOf: null, staleQuote: true, deliverable: 'standard', dataQualityWarnings: [],
  }],
  options: [], workingOrders: [],
  coverageEvidence: {
    existingShortCallsBySymbol: { AAPL: 1 }, workingShortCallsBySymbol: {},
    unclassifiedSymbols: [], complete: true, warnings: [], hasAdjustedOrUnknownDeliverable: false,
  },
  dataQuality: { status: 'ok', staleQuotes: true, warnings: [] },
  freshness: 'current', lastSuccessfulAsOf: '2026-08-22T18:00:00.000Z',
  ...overrides,
});

const comparedAt = '2026-08-22T18:01:00.000Z';

describe('Covered Call capacity shadow parity', () => {
  it('keeps the dedicated shadow flag default-off and independently configurable', () => {
    expect(isCcCapacityShadowEnabled(undefined)).toBe(false);
    expect(isCcCapacityShadowEnabled('false')).toBe(false);
    expect(isCcCapacityShadowEnabled('true')).toBe(true);
  });

  it('reports exact parity without differences and without mutating inputs', () => {
    const oldReport = legacy();
    const currentSnapshot = snapshot();
    const oldBefore = structuredClone(oldReport);
    const snapshotBefore = structuredClone(currentSnapshot);
    expect(compareCoveredCallCapacityShadow(oldReport, currentSnapshot, comparedAt)).toEqual({
      outcome: 'parity', differences: [], comparedAt,
      snapshotAsOf: currentSnapshot.asOf, snapshotFreshness: 'current',
    });
    expect(oldReport).toEqual(oldBefore);
    expect(currentSnapshot).toEqual(snapshotBefore);
  });

  it('reports deterministic per-field differences', () => {
    const result = compareCoveredCallCapacityShadow(legacy({ bySymbol: { AAPL: capacity({ sharesOwned: 100, availableCoveredContracts: 0 }) } }), snapshot(), comparedAt);
    expect(result.outcome).toBe('difference');
    expect(result.differences).toEqual([
      { kind: 'field', symbol: 'AAPL', field: 'sharesOwned', legacy: 100, snapshot: 200 },
      { kind: 'field', symbol: 'AAPL', field: 'availableCoveredContracts', legacy: 0, snapshot: 1 },
    ]);
  });

  it('reports symbols found on only one side in sorted order', () => {
    const result = compareCoveredCallCapacityShadow(legacy({ bySymbol: { ZZZ: capacity() } }), snapshot(), comparedAt);
    expect(result.differences).toEqual([
      { kind: 'symbol-only', symbol: 'AAPL', side: 'snapshot' },
      { kind: 'symbol-only', symbol: 'ZZZ', side: 'legacy' },
    ]);
  });

  it('reports status, normalized warnings, and unavailable-reason differences', () => {
    const result = compareCoveredCallCapacityShadow(legacy({
      status: 'unavailable',
      warnings: [' z warning ', 'a warning', 'a warning'],
      unavailableReason: 'legacy unavailable',
    }), snapshot(), comparedAt);
    expect(result.differences[0]).toEqual({ kind: 'status', legacy: 'unavailable', snapshot: 'ok' });
    expect(result.differences).toContainEqual({ kind: 'warnings', legacy: ['a warning', 'z warning'], snapshot: [] });
    expect(result.differences).toContainEqual({ kind: 'unavailableReason', legacy: 'legacy unavailable', snapshot: null });
  });

  it.each([
    ['missing', null, 'snapshot-missing'],
    ['last-known', snapshot({ freshness: 'last-known' }), 'snapshot-last-known'],
    ['unavailable', snapshot({ dataQuality: { status: 'unavailable', staleQuotes: true, warnings: [], unavailableReason: 'orders failed' } }), 'snapshot-unavailable'],
  ])('skips %s snapshots rather than claiming parity', (_label, value, reason) => {
    expect(compareCoveredCallCapacityShadow(legacy(), value as PortfolioSnapshot | null, comparedAt)).toEqual(expect.objectContaining({
      outcome: 'skipped', reason, differences: [],
    }));
  });

  it('redacts the snapshot account number from normalized diagnostics', () => {
    const result = compareCoveredCallCapacityShadow(legacy({
      warnings: ['Account SECRET-ACCOUNT-123 warning'],
      unavailableReason: 'SECRET-ACCOUNT-123 unavailable',
    }), snapshot(), comparedAt);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('SECRET-ACCOUNT-123');
    expect(serialized).toContain('[REDACTED_ACCOUNT]');
    expect(serialized).not.toContain('rawPositions');
  });

  it('emits a structured event and isolates logger failures', () => {
    const logger = vi.fn();
    expect(emitCoveredCallCapacityShadow(legacy(), snapshot(), logger, comparedAt)?.outcome).toBe('parity');
    expect(logger).toHaveBeenCalledWith(CC_CAPACITY_SHADOW_EVENT, expect.objectContaining({ outcome: 'parity' }));
    expect(emitCoveredCallCapacityShadow(legacy(), snapshot(), () => { throw new Error('telemetry unavailable'); }, comparedAt)).toBeNull();
  });
});
