// lib/portfolio-ai/__tests__/fromPositions.test.ts

import { describe, expect, it } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';
import { toPortfolioAiPositions } from '../fromPositions';

const make = (over: Record<string, unknown>) => ({
  key: 'a', symbol: 'AAA', strategy: 'Bull Put Spread', dte: 25, legs: [],
  entryPriceEffect: 'Credit', entryCredit: 1, entryEconomicsComplete: true, creditReceived: 1,
  pnl: 0.25, maxRisk: 400, maxRiskReliable: true, buffer: 6.5,
  needsClose: false, hitTarget: false, hasGtc: true, recommendation: null, ...over,
}) as unknown as Position;

describe('toPortfolioAiPositions', () => {
  it('uses the fail-closed helpers and the canonical recommendation', () => {
    const [p] = toPortfolioAiPositions([make({
      recommendation: { label: 'Hold', suggestedAction: 'Keep monitoring', primaryReason: 'r', kind: 'hold' },
    })]);
    expect(p.entryPnlPct).toBe(25);
    expect(p.maxRisk).toBe(400);
    expect(p.recommendationLabel).toBe('Hold');
    expect(p.recommendationDetail).toBe('Keep monitoring');
  });

  it('nulls max risk and P&L when entry economics are not reliable, and has no action without a canonical rec', () => {
    const [p] = toPortfolioAiPositions([make({ maxRiskReliable: false, entryEconomicsComplete: false, buffer: null })]);
    expect(p.maxRisk).toBeNull();
    expect(p.entryPnlPct).toBeNull();
    expect(p.bufferPct).toBeNull();
    expect(p.recommendationLabel).toBeNull();
  });
});
