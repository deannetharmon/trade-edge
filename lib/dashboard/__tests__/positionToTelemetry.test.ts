import { describe, it, expect } from 'vitest';
import { positionToTelemetry } from '../positionToTelemetry';
import type { Position } from '@/lib/portfolio-data/types';

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    symbol: 'SOXL', strategy: 'BPS',
    closeNowPnl: 150, pnl: 150,
    deltaAtEntry: 0.20, netDelta: 0.28,
    thetaAtEntry: 0.10, theta: 0.14,
    gammaAtEntry: 0.006, gamma: 0.009,
    vegaAtEntry: 0.30, netVega: 0.22,
    ivAtEntry: 32, iv: 38,
    ivrAtEntry: 31, ivr: 34,
    ...overrides,
  } as Position;
}

describe('positionToTelemetry', () => {
  it('maps a complete BPS position correctly, including plStart being definitionally zero', () => {
    const result = positionToTelemetry(makePosition());
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('BPS');
    expect(result!.symbol).toBe('SOXL');
    expect(result!.plStart).toBe(0);
    expect(result!.plNow).toBe(150);
    expect(result!.deltaStart).toBe(0.20);
    expect(result!.deltaNow).toBe(0.28);
  });

  it('maps IC to IRON_CONDOR (same strategy, different naming convention)', () => {
    const result = positionToTelemetry(makePosition({ strategy: 'IC' }));
    expect(result?.strategy).toBe('IRON_CONDOR');
  });

  it('maps BCS correctly, now that the type has been widened', () => {
    const result = positionToTelemetry(makePosition({ strategy: 'BCS' }));
    expect(result?.strategy).toBe('BCS');
  });

  it('never fabricates shortLeg for a real spread (BPS) -- net entry delta is not the short leg\u2019s own delta', () => {
    const result = positionToTelemetry(makePosition({ strategy: 'BPS' }));
    expect(result?.shortLeg).toBeUndefined();
  });

  it('populates shortLeg for a single-short-leg strategy (CSP), where net entry delta IS the leg\u2019s own delta', () => {
    const result = positionToTelemetry(makePosition({
      strategy: 'CSP',
      deltaAtEntry: -0.22,
      legs: [{ symbol: 'MU', optionType: 'P', strikePrice: 90, direction: 'Short', quantity: 1, avgOpenPrice: 2, currentPrice: 1.5, currentDelta: -0.28 } as any],
    }));
    expect(result?.shortLeg).toBeDefined();
    expect(result?.shortLeg?.strike).toBe(90);
    expect(result?.shortLeg?.optionType).toBe('P');
    expect(result?.shortLeg?.deltaStart).toBeCloseTo(0.22, 5); // absolute value
    expect(result?.shortLeg?.deltaNow).toBeCloseTo(0.28, 5);
  });

  it('omits shortLeg for CSP when the short leg or its currentDelta is missing, rather than guessing', () => {
    const result = positionToTelemetry(makePosition({ strategy: 'CSP', legs: [] }));
    expect(result?.shortLeg).toBeUndefined();
  });

  it('returns null for an unrecognized strategy rather than mislabeling it', () => {
    expect(positionToTelemetry(makePosition({ strategy: 'ROLL' }))).toBeNull();
    expect(positionToTelemetry(makePosition({ strategy: 'UNKNOWN' }))).toBeNull();
  });

  it('returns null when P/L is unavailable, rather than fabricating zero', () => {
    expect(positionToTelemetry(makePosition({ closeNowPnl: null, pnl: null }))).toBeNull();
  });

  it('falls back to pnl when closeNowPnl is unavailable', () => {
    const result = positionToTelemetry(makePosition({ closeNowPnl: null, pnl: 88 }));
    expect(result?.plNow).toBe(88);
  });

  it('returns null when any entry-time Greek is missing', () => {
    expect(positionToTelemetry(makePosition({ deltaAtEntry: null }))).toBeNull();
    expect(positionToTelemetry(makePosition({ thetaAtEntry: null }))).toBeNull();
    expect(positionToTelemetry(makePosition({ gammaAtEntry: null }))).toBeNull();
    expect(positionToTelemetry(makePosition({ vegaAtEntry: null }))).toBeNull();
  });

  it('returns null when any current-value Greek is missing', () => {
    expect(positionToTelemetry(makePosition({ netDelta: null }))).toBeNull();
    expect(positionToTelemetry(makePosition({ theta: null }))).toBeNull();
    expect(positionToTelemetry(makePosition({ gamma: null }))).toBeNull();
    expect(positionToTelemetry(makePosition({ netVega: null }))).toBeNull();
  });

  it('returns null when IV or IVR data is missing at either end', () => {
    expect(positionToTelemetry(makePosition({ ivAtEntry: null }))).toBeNull();
    expect(positionToTelemetry(makePosition({ iv: null }))).toBeNull();
    expect(positionToTelemetry(makePosition({ ivrAtEntry: null }))).toBeNull();
    expect(positionToTelemetry(makePosition({ ivr: null }))).toBeNull();
  });
});
