import { describe, it, expect } from 'vitest';
import {
  classifyPositionLifecycle,
  isPmccPosition,
  isSpreadPosition,
  type LifecycleLeg,
} from '../positionLifecycle';

// Real, dynamically-computed OCC symbols (root + YYMMDD + C/P + 8-digit
// strike in thousandths), offset from actual test-run time -- avoids the
// exact date-boundary flakiness already found elsewhere tonight
// (lib/scans/__tests__/cspSearch.test.ts) from a hardcoded expiration.
function occSymbol(root: string, daysFromNow: number, type: 'C' | 'P', strike: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${root}${yy}${mm}${dd}${type}${String(strike * 1000).padStart(8, '0')}`;
}

function callLeg(symbol: string, direction: 'Long' | 'Short', strike: number): LifecycleLeg {
  return { symbol, optionType: 'C', strikePrice: strike, direction, quantity: 1 };
}

describe('isPmccPosition', () => {
  it('classifies a real PMCC shape: short call under 60 DTE, long call over 120 DTE', () => {
    const legs = [
      callLeg(occSymbol('AAPL', 45, 'C', 200), 'Short', 200),
      callLeg(occSymbol('AAPL', 365, 'C', 150), 'Long', 150),
    ];
    expect(isPmccPosition(legs)).toBe(true);
  });

  it('does not classify a same-expiration vertical call spread as PMCC', () => {
    const legs = [
      callLeg(occSymbol('AAPL', 30, 'C', 200), 'Short', 200),
      callLeg(occSymbol('AAPL', 30, 'C', 190), 'Long', 190),
    ];
    expect(isPmccPosition(legs)).toBe(false);
    // Regression guard for Quinn's ordering concern: since isPmccPosition
    // is checked before isSpreadPosition in classifyPositionLifecycle, a
    // genuine same-expiration vertical must still fall through to SPREAD,
    // not get swept into the new, more-specific PMCC branch by accident.
    expect(isSpreadPosition(legs)).toBe(true);
    expect(classifyPositionLifecycle({ symbol: 'AAPL', legs }).type).toBe('SPREAD');
  });

  it('boundary: short DTE exactly at the 60-day cutoff does not qualify (must be strictly under)', () => {
    const legs = [
      callLeg(occSymbol('AAPL', 60, 'C', 200), 'Short', 200),
      callLeg(occSymbol('AAPL', 365, 'C', 150), 'Long', 150),
    ];
    expect(isPmccPosition(legs)).toBe(false);
  });

  it('boundary: short DTE one day under the cutoff qualifies', () => {
    const legs = [
      callLeg(occSymbol('AAPL', 59, 'C', 200), 'Short', 200),
      callLeg(occSymbol('AAPL', 365, 'C', 150), 'Long', 150),
    ];
    expect(isPmccPosition(legs)).toBe(true);
  });

  it('boundary: long DTE exactly at the 120-day cutoff does not qualify (must be strictly over)', () => {
    const legs = [
      callLeg(occSymbol('AAPL', 45, 'C', 200), 'Short', 200),
      callLeg(occSymbol('AAPL', 120, 'C', 150), 'Long', 150),
    ];
    expect(isPmccPosition(legs)).toBe(false);
  });

  it('boundary: long DTE one day over the cutoff qualifies', () => {
    const legs = [
      callLeg(occSymbol('AAPL', 45, 'C', 200), 'Short', 200),
      callLeg(occSymbol('AAPL', 121, 'C', 150), 'Long', 150),
    ];
    expect(isPmccPosition(legs)).toBe(true);
  });

  it('known limitation: a wide call spread with a far-dated long leg still classifies as PMCC even when the long leg is not actually deep ITM', () => {
    // Documents the accepted gap flagged during scoping: LifecycleLeg has
    // no delta/moneyness field, so this cannot yet distinguish a genuine
    // LEAPS-anchored diagonal from a speculative wide call spread that
    // happens to clear the DTE thresholds. This is expected, current
    // behavior, not a bug -- the test exists so a future fix changing
    // this result is a deliberate decision, not an accidental regression.
    const legs = [
      callLeg(occSymbol('AAPL', 45, 'C', 200), 'Short', 200),
      callLeg(occSymbol('AAPL', 130, 'C', 500), 'Long', 500), // far OTM, not deep ITM
    ];
    expect(isPmccPosition(legs)).toBe(true);
  });

  it('unparseable symbols never throw and never false-positive', () => {
    const legs = [
      callLeg('not-a-real-occ-symbol', 'Short', 200),
      callLeg('also-not-real', 'Long', 150),
    ];
    expect(() => isPmccPosition(legs)).not.toThrow();
    expect(isPmccPosition(legs)).toBe(false);
  });

  it('classifyPositionLifecycle returns PMCC, not SPREAD, for a real PMCC shape', () => {
    const legs = [
      callLeg(occSymbol('NVDA', 30, 'C', 900), 'Short', 900),
      callLeg(occSymbol('NVDA', 400, 'C', 600), 'Long', 600),
    ];
    const result = classifyPositionLifecycle({ symbol: 'NVDA', legs });
    expect(result.type).toBe('PMCC');
    expect(result.shortCalls).toHaveLength(1);
    expect(result.longCalls).toHaveLength(1);
  });
});

