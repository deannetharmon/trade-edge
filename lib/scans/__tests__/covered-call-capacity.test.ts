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
    expect(exposure.bySymbol.NKE ?? 0).toBe(0);
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
    expect(reservations.bySymbol.NKE ?? 0).toBe(0);
  });

  it('11. working buy-to-close calls do not reserve new capacity', () => {
    const reservations = normalizeWorkingCallReservations([workingBtcCall('MU', 2, 'Live')]);
    expect(reservations.bySymbol.MU ?? 0).toBe(0);
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

// ── TE-0007C corrective round: real broker coverage evidence ───────────────
// Real TastyTrade position/order-leg payloads do NOT reliably carry an
// `option-type` field -- lib/portfolio-data/acquisition.ts's own
// parseOptionSymbol already derives put/call from the OCC symbol for every
// real position leg it processes, and mapGtcOrder's real leg shape is just
// `{ symbol, action }` -- no option-type at all. These fixtures mirror that
// reality: OCC symbol only, no option-type, and (for several) no
// underlying-symbol field either, forcing OCC-symbol parsing end to end.
describe('TE-0007C corrective round: OCC-symbol-derived classification (no option-type field)', () => {
  // OCC format: ROOT + YYMMDD + C/P + 8-digit strike (thousandths).
  const occ = (root: string, date: string, cp: 'C' | 'P', strike: number) =>
    `${root}${date}${cp}${String(Math.round(strike * 1000)).padStart(8, '0')}`;

  const NKE_CALL_OCC = occ('NKE', '260918', 'C', 95);
  const MU_CALL_OCC = occ('MU', '260918', 'C', 120);
  const MU_PUT_OCC = occ('MU', '260918', 'P', 90);

  // Realistic short-call position with ONLY an OCC symbol -- no option-type,
  // no underlying-symbol field (both must be derived from the OCC string).
  const occOnlyShortCall = (occSymbol: string, qty: number): RawPositionLike => ({
    'instrument-type': 'Equity Option',
    symbol: occSymbol,
    quantity: qty,
    'quantity-direction': 'Short',
  });

  const occOnlyShortPut = (occSymbol: string, qty: number): RawPositionLike => ({
    'instrument-type': 'Equity Option',
    symbol: occSymbol,
    quantity: qty,
    'quantity-direction': 'Short',
  });

  // Realistic working sell-to-open leg with ONLY an OCC symbol -- mirrors
  // acquisition.ts's mapGtcOrder, whose real leg shape is `{symbol, action}`
  // with no option-type and no underlying-symbol field at all.
  const occOnlyWorkingStoCall = (occSymbol: string, qty: number, status = 'Live'): RawOrderLike => ({
    status,
    legs: [{ symbol: occSymbol, action: 'Sell to Open', quantity: qty }],
  });

  const occOnlyWorkingBtcCall = (occSymbol: string, qty: number, status = 'Live'): RawOrderLike => ({
    status,
    legs: [{ symbol: occSymbol, action: 'Buy to Close', quantity: qty }],
  });

  // Requirement 1: a short-call position with only an OCC symbol consumes coverage.
  it('1. a short-call position with only an OCC symbol consumes coverage (no option-type field)', () => {
    const exposure = normalizeShortCallExposure([occOnlyShortCall(NKE_CALL_OCC, 1)]);
    expect(exposure.bySymbol.NKE).toBe(1);
    expect(exposure.unclassifiedSymbols.has('NKE')).toBe(false); // successfully classified via OCC parsing
  });

  // Requirement 2: a working sell-to-open call with only an OCC symbol reserves coverage.
  it('2. a working sell-to-open call with only an OCC symbol reserves coverage (no option-type field)', () => {
    const reservations = normalizeWorkingCallReservations([occOnlyWorkingStoCall(MU_CALL_OCC, 1)]);
    expect(reservations.bySymbol.MU).toBe(1);
    expect(reservations.unclassifiedSymbols.has('MU')).toBe(false);
  });

  // Requirement 3: one existing short call plus one working STO call subtracts both quantities.
  it('3. one existing short call plus one working STO call subtracts both quantities from capacity', () => {
    const report = buildCoveredCallCapacityReport(
      [equity('MU', 500, 'Long', 800), occOnlyShortCall(MU_CALL_OCC, 2)],
      [occOnlyWorkingStoCall(MU_CALL_OCC, 1)],
    );
    // gross 5 - existing 2 - working 1 = 2
    expect(report.bySymbol.MU.existingShortCallContracts).toBe(2);
    expect(report.bySymbol.MU.workingShortCallContracts).toBe(1);
    expect(report.bySymbol.MU.availableCoveredContracts).toBe(2);
  });

  // Requirement 4: an unclassifiable short option cannot silently leave capacity available.
  it('4. an unclassifiable short option is conservatively reserved, never silently ignored', () => {
    const unclassifiable: RawPositionLike = {
      'instrument-type': 'Equity Option',
      'underlying-symbol': 'IBM',
      symbol: 'not-a-valid-occ-symbol', // unparseable AND no option-type field
      quantity: 1,
      'quantity-direction': 'Short',
    };
    const exposure = normalizeShortCallExposure([unclassifiable]);
    // Conservatively reserved as if it were a call — capacity can never be
    // overstated by a position TradeEdge couldn't actually classify.
    expect(exposure.bySymbol.IBM).toBe(1);
    expect(exposure.unclassifiedSymbols.has('IBM')).toBe(true);

    const report = buildCoveredCallCapacityReport(
      [equity('IBM', 100, 'Long', 150), unclassifiable],
      [],
    );
    expect(report.bySymbol.IBM.availableCoveredContracts).toBe(0); // never left "available"
    expect(report.bySymbol.IBM.hasUnclassifiedExposure).toBe(true);
  });

  // Requirement 5: status/action casing and accepted broker variants normalize correctly.
  it('5. status and action casing variants normalize correctly (live/LIVE/Working, sell to open in any case)', () => {
    const reservations = normalizeWorkingCallReservations([
      { status: 'live', legs: [{ symbol: NKE_CALL_OCC, action: 'sell to open', quantity: 1 }] },
      { status: 'LIVE', legs: [{ symbol: NKE_CALL_OCC, action: 'SELL TO OPEN', quantity: 1 }] },
      { status: 'Working', legs: [{ symbol: NKE_CALL_OCC, action: '  Sell to Open  ', quantity: 1 }] },
    ]);
    expect(reservations.bySymbol.NKE).toBe(3);
  });

  // Requirement 6: buy-to-close does not reserve new capacity (OCC-only leg).
  it('6. buy-to-close does not reserve new capacity, even with only an OCC symbol', () => {
    const reservations = normalizeWorkingCallReservations([occOnlyWorkingBtcCall(MU_CALL_OCC, 2)]);
    expect(reservations.bySymbol.MU ?? 0).toBe(0);
  });

  // A genuinely OCC-classified put (no option-type field) still never
  // consumes call coverage — proves the OCC fallback path itself respects
  // put/call correctly, not just "anything unparseable becomes a call."
  it('a genuinely-classified put (via OCC symbol only) never consumes call coverage', () => {
    const exposure = normalizeShortCallExposure([occOnlyShortPut(MU_PUT_OCC, 2)]);
    expect(exposure.bySymbol.MU ?? 0).toBe(0);
    expect(exposure.unclassifiedSymbols.has('MU')).toBe(false);
  });

  // Requirement 7: partial cost-basis coverage produces null/incomplete basis.
  it('7. partial cost-basis coverage (one lot known, one lot missing) produces null costBasis, not a partially-applied average', () => {
    const holdings = normalizeEquityHoldings([
      equity('XOM', 100, 'Long', 80), // known basis
      equity('XOM', 100, 'Long'),     // missing basis (no average-open-price)
    ]);
    expect(holdings.XOM.sharesOwned).toBe(200);
    expect(holdings.XOM.costBasis).toBeNull(); // NOT 80 applied to all 200 shares
    expect(holdings.XOM.costBasisComplete).toBe(false);
  });

  it('a fully-known cost basis across multiple lots is reported complete', () => {
    const holdings = normalizeEquityHoldings([
      equity('XOM', 100, 'Long', 80),
      equity('XOM', 100, 'Long', 84),
    ]);
    expect(holdings.XOM.costBasisComplete).toBe(true);
    expect(holdings.XOM.costBasis).toBeCloseTo(82, 5);
  });

  // Requirement 8: basis-dependent fields remain null when basis is incomplete.
  it('8. CoveredCallCapacity.costBasis stays null end-to-end when basis is incomplete', () => {
    const report = buildCoveredCallCapacityReport(
      [equity('XOM', 100, 'Long', 80), equity('XOM', 100, 'Long')],
      [],
    );
    expect(report.bySymbol.XOM.costBasis).toBeNull();
    expect(report.bySymbol.XOM.costBasisComplete).toBe(false);
  });

  // Requirement 15 (capacity half): available recommended contracts never
  // exceed verified capacity even when unclassified exposure, partial
  // basis, and working reservations are all present simultaneously.
  it('15. availableCoveredContracts never exceeds verified capacity under combined unclassified/partial-basis conditions', () => {
    const report = buildCoveredCallCapacityReport(
      [
        equity('QCOM', 300, 'Long', 150),
        equity('QCOM', 100, 'Long'), // partial basis
        { 'instrument-type': 'Equity Option', 'underlying-symbol': 'QCOM', symbol: 'garbage', quantity: 1, 'quantity-direction': 'Short' }, // unclassifiable
      ],
      [occOnlyWorkingStoCall(occ('QCOM', '260918', 'C', 200), 1)],
    );
    const cap = report.bySymbol.QCOM;
    // gross = floor(400/100) = 4; existing (unclassified, conservative) = 1; working = 1 -> available = 2
    expect(cap.grossCoveredContracts).toBe(4);
    expect(cap.availableCoveredContracts).toBe(2);
    expect(cap.availableCoveredContracts).toBeLessThanOrEqual(cap.grossCoveredContracts);
    expect(cap.costBasis).toBeNull();
    expect(cap.hasUnclassifiedExposure).toBe(true);
  });

  // "Complete end-to-end capacity fixture shaped like the actual /positions
  // and /orders/live responses used elsewhere in TradeEdge" — mirrors the
  // exact raw shapes lib/portfolio-data/acquisition.ts's loadPositions() and
  // mapGtcOrder() work with (space-padded OCC symbols in `symbol`, no
  // option-type field anywhere, order legs shaped as `{symbol, action}`
  // plus a top-level order `status`), rather than synthetic convenience
  // fields a production broker response would not actually provide.
  it('end-to-end: realistic /positions + /orders/live shaped fixture (space-padded OCC symbols, no option-type anywhere)', () => {
    const rawPositions: RawPositionLike[] = [
      // 500 shares of MU, cost basis fully known across two lots.
      { 'instrument-type': 'Equity', symbol: 'MU', quantity: '300', 'quantity-direction': 'Long', 'average-open-price': '78.50' },
      { 'instrument-type': 'Equity', symbol: 'MU', quantity: '200', 'quantity-direction': 'Long', 'average-open-price': '82.10' },
      // One existing short call, space-padded OCC symbol exactly like a real TastyTrade position, no option-type field.
      { 'instrument-type': 'Equity Option', symbol: 'MU    260918C00120000', quantity: '1', 'quantity-direction': 'Short' },
    ];
    const rawOrders: RawOrderLike[] = [
      {
        status: 'Live',
        legs: [{ symbol: 'MU    260918C00130000', action: 'Sell to Open', quantity: '1' }],
      },
      {
        // A cancelled duplicate attempt must not double-reserve.
        status: 'Cancelled',
        legs: [{ symbol: 'MU    260918C00125000', action: 'Sell to Open', quantity: '1' }],
      },
    ];

    const report = buildCoveredCallCapacityReport(rawPositions, rawOrders);
    expect(report.status).toBe('ok');
    const mu = report.bySymbol.MU;
    expect(mu.sharesOwned).toBe(500);
    expect(mu.costBasisComplete).toBe(true);
    expect(mu.costBasis).toBeCloseTo((300 * 78.5 + 200 * 82.1) / 500, 5);
    expect(mu.grossCoveredContracts).toBe(5);
    expect(mu.existingShortCallContracts).toBe(1);
    expect(mu.workingShortCallContracts).toBe(1); // only the Live order, not the Cancelled one
    expect(mu.availableCoveredContracts).toBe(3);
    expect(mu.hasUnclassifiedExposure).toBe(false); // both option legs classified via OCC parsing
  });
});
