// lib/scans/__tests__/covered-call-capacity.test.ts
// TE-0007C — capacity calculation tests (ticket "Testing" §1, cases 1–14).
import { describe, it, expect } from 'vitest';
import {
  normalizeEquityHoldings,
  normalizeShortCallExposure,
  normalizeWorkingCallReservations,
  computeCoveredCallCapacity,
  buildCoveredCallCapacityReport,
  type RawPositionLike,
  type RawOrderLike,
} from '../covered-call-capacity';

const equity = (symbol: string, qty: number, direction = 'Long', avgPrice?: number): RawPositionLike => ({
  'instrument-type': 'Equity',
  'underlying-symbol': symbol,
  symbol,
  quantity: qty,
  'quantity-direction': direction,
  ...(avgPrice != null ? { 'average-open-price': avgPrice } : {}),
});

const shortCall = (symbol: string, qty: number): RawPositionLike => ({
  'instrument-type': 'Equity Option',
  'underlying-symbol': symbol,
  'option-type': 'C',
  quantity: qty,
  'quantity-direction': 'Short',
});

const longCall = (symbol: string, qty: number): RawPositionLike => ({
  'instrument-type': 'Equity Option',
  'underlying-symbol': symbol,
  'option-type': 'C',
  quantity: qty,
  'quantity-direction': 'Long',
});

const shortPut = (symbol: string, qty: number): RawPositionLike => ({
  'instrument-type': 'Equity Option',
  'underlying-symbol': symbol,
  'option-type': 'P',
  quantity: qty,
  'quantity-direction': 'Short',
});

const workingStoCall = (symbol: string, qty: number, status = 'Live'): RawOrderLike => ({
  status,
  legs: [{ 'underlying-symbol': symbol, action: 'Sell to Open', 'instrument-type': 'Equity Option', 'option-type': 'C', quantity: qty }],
});

const workingBtcCall = (symbol: string, qty: number, status = 'Live'): RawOrderLike => ({
  status,
  legs: [{ 'underlying-symbol': symbol, action: 'Buy to Close', 'instrument-type': 'Equity Option', 'option-type': 'C', quantity: qty }],
});

describe('computeCoveredCallCapacity: ticket cases 1-7', () => {
  it('1. 99 shares -> zero contracts', () => {
    const c = computeCoveredCallCapacity(99, 0, 0);
    expect(c.grossCoveredContracts).toBe(0);
    expect(c.availableCoveredContracts).toBe(0);
  });

  it('2. 100 shares and no calls -> one', () => {
    const c = computeCoveredCallCapacity(100, 0, 0);
    expect(c.grossCoveredContracts).toBe(1);
    expect(c.availableCoveredContracts).toBe(1);
  });

  it('3. 250 shares and no calls -> two', () => {
    const c = computeCoveredCallCapacity(250, 0, 0);
    expect(c.grossCoveredContracts).toBe(2);
    expect(c.availableCoveredContracts).toBe(2);
  });

  it('4. 500 shares with two open short calls -> three', () => {
    const c = computeCoveredCallCapacity(500, 2, 0);
    expect(c.grossCoveredContracts).toBe(5);
    expect(c.availableCoveredContracts).toBe(3);
  });

  it('5. 500 shares with two open short calls and one working STO call -> two', () => {
    const c = computeCoveredCallCapacity(500, 2, 1);
    expect(c.availableCoveredContracts).toBe(2);
  });

  it('6. existing calls fully consume coverage -> zero', () => {
    const c = computeCoveredCallCapacity(200, 2, 0);
    expect(c.availableCoveredContracts).toBe(0);
    expect(c.oversubscribed).toBe(false);
  });

  it('7. existing calls exceed share coverage -> zero plus oversubscribed warning', () => {
    const c = computeCoveredCallCapacity(200, 3, 0);
    expect(c.availableCoveredContracts).toBe(0);
    expect(c.oversubscribed).toBe(true);
  });
});

describe('normalizeShortCallExposure / normalizeEquityHoldings: ticket cases 8-13', () => {
  it('8. short puts do not consume call coverage', () => {
    const exposure = normalizeShortCallExposure([shortPut('NKE', 2)]);
    expect(exposure.NKE ?? 0).toBe(0);
  });

  it('9. long calls do not create stock coverage', () => {
    const holdings = normalizeEquityHoldings([longCall('NKE', 5) as any]);
    expect(holdings.NKE).toBeUndefined();
  });

  it('12. multiple equity lots for the same symbol aggregate correctly', () => {
    const holdings = normalizeEquityHoldings([
      equity('MU', 200, 'Long', 80),
      equity('MU', 300, 'Long', 90),
    ]);
    expect(holdings.MU.sharesOwned).toBe(500);
    // quantity-weighted average: (200*80 + 300*90) / 500 = 86
    expect(holdings.MU.costBasis).toBeCloseTo(86, 5);
  });

  it('13. short stock or invalid quantities never create coverage', () => {
    const holdings = normalizeEquityHoldings([
      equity('TSLA', 100, 'Short'),
      equity('TSLA', 0, 'Long'),
      equity('TSLA', -50, 'Long'),
    ]);
    expect(holdings.TSLA).toBeUndefined();
  });
});

describe('normalizeWorkingCallReservations: ticket cases 10-11', () => {
  it('10. cancelled/rejected orders do not reserve capacity', () => {
    const reservations = normalizeWorkingCallReservations([
      workingStoCall('NKE', 1, 'Cancelled'),
      workingStoCall('NKE', 1, 'Rejected'),
      workingStoCall('NKE', 1, 'Filled'),
      workingStoCall('NKE', 1, 'Expired'),
    ]);
    expect(reservations.NKE ?? 0).toBe(0);
  });

  it('11. working buy-to-close calls do not reserve new capacity', () => {
    const reservations = normalizeWorkingCallReservations([workingBtcCall('MU', 2, 'Live')]);
    expect(reservations.MU ?? 0).toBe(0);
  });
});

describe('buildCoveredCallCapacityReport: end-to-end wiring, ticket case 14', () => {
  it('14. missing holdings data produces unavailable, not zero-safe eligibility', () => {
    const report = buildCoveredCallCapacityReport(null, []);
    expect(report.status).toBe('unavailable');
    expect(report.bySymbol).toEqual({});
  });

  it('missing working-orders data also produces unavailable', () => {
    const report = buildCoveredCallCapacityReport([], null);
    expect(report.status).toBe('unavailable');
  });

  it('end-to-end: NKE 100 shares, no short call -> one available contract', () => {
    const report = buildCoveredCallCapacityReport([equity('NKE', 100, 'Long', 42)], []);
    expect(report.status).toBe('ok');
    expect(report.bySymbol.NKE.availableCoveredContracts).toBe(1);
    expect(report.bySymbol.NKE.costBasis).toBe(42);
  });

  it('end-to-end: MU 500 shares, two existing short calls -> three available contracts', () => {
    const report = buildCoveredCallCapacityReport(
      [equity('MU', 500, 'Long', 800), shortCall('MU', 2)],
      [],
    );
    expect(report.bySymbol.MU.availableCoveredContracts).toBe(3);
  });

  it('end-to-end: 100 shares plus one existing short call -> zero available, no naked-call recommendation', () => {
    const report = buildCoveredCallCapacityReport(
      [equity('AAPL', 100, 'Long', 200), shortCall('AAPL', 1)],
      [],
    );
    expect(report.bySymbol.AAPL.availableCoveredContracts).toBe(0);
  });
});
