import { describe, expect, it } from 'vitest';
import type { InstrumentMetadata } from '@/lib/instrument-metadata';
import { aggregatePortfolioStress, evaluateLongInstrumentStressSet } from '../portfolioStress';
import { DEFAULT_LEV_STRESS_SCENARIOS } from '../stressTypes';

const meta = (symbol: string, underlying: string, multiplier: number): InstrumentMetadata => ({
  symbol,
  classification: multiplier === 1 ? 'COMMON_STOCK' : multiplier < 0 ? 'LEVERAGED_INVERSE_ETF_ETP' : 'LEVERAGED_ETF_ETP',
  economicUnderlyingSymbol: underlying,
  signedLeverageMultiplier: multiplier === 1 ? undefined : multiplier,
  resetFrequency: multiplier === 1 ? 'NOT_APPLICABLE' : 'DAILY',
  confidence: 'COMPLETE',
  confidenceReasons: [],
  provenance: { provider: 'fixture', asOf: '2026-10-01T00:00:00.000Z' },
});

describe('LEV-0001 scenario sets and portfolio stress', () => {
  it('evaluates the configured ±5/10/15/20 scenario set', () => {
    const results = evaluateLongInstrumentStressSet(
      { metadata: meta('NVDU', 'NVDA', 2), marketValue: 10_000 },
      DEFAULT_LEV_STRESS_SCENARIOS,
    );
    expect(results.map(r => r.underlyingMovePct)).toEqual([-20, -15, -10, -5, 5, 10, 15, 20]);
    expect(results.find(r => r.underlyingMovePct === -20)).toMatchObject({
      estimatedInstrumentMovePct: -40,
      estimatedLoss: 4_000,
      approximation: true,
    });
  });

  it('aggregates same-scenario P&L across normalized positions', () => {
    const report = aggregatePortfolioStress([
      { positionId: 'nvda', economicUnderlying: 'NVDA', input: { metadata: meta('NVDA', 'NVDA', 1), marketValue: 10_000 } },
      { positionId: 'nvdu', economicUnderlying: 'NVDA', input: { metadata: meta('NVDU', 'NVDA', 2), marketValue: 5_000 } },
      { positionId: 'nvdd', economicUnderlying: 'NVDA', input: { metadata: meta('NVDD', 'NVDA', -1), marketValue: 2_000 } },
    ], { id: 'down-10', underlyingMovesPct: [-10] });

    expect(report.results[0]).toMatchObject({
      underlyingMovePct: -10,
      estimatedPnl: -1_800,
      estimatedLoss: 1_800,
      normalizedPositionCount: 3,
      incompletePositionIds: [],
      complete: true,
    });
  });

  it('fails portfolio stress closed rather than understating loss when one position is incomplete', () => {
    const incomplete = meta('MYSTERY', 'NVDA', 2);
    incomplete.confidence = 'PARTIAL';
    incomplete.signedLeverageMultiplier = undefined;

    const report = aggregatePortfolioStress([
      { positionId: 'known', economicUnderlying: 'NVDA', input: { metadata: meta('NVDA', 'NVDA', 1), marketValue: 10_000 } },
      { positionId: 'unknown', economicUnderlying: 'NVDA', input: { metadata: incomplete, marketValue: 5_000 } },
    ], { id: 'down-10', underlyingMovesPct: [-10] });

    expect(report.results[0]).toMatchObject({
      estimatedPnl: null,
      estimatedLoss: null,
      normalizedPositionCount: 1,
      incompletePositionIds: ['unknown'],
      complete: false,
    });
  });
});
