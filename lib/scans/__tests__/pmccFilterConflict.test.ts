// lib/scans/__tests__/pmccFilterConflict.test.ts

import { describe, expect, it } from 'vitest';
import { detectPmccFilterConflict } from '../pmccFilterConflict';
import type { PmccLegRejection } from '../pmccTypes';

const floorOnly = (strike: number, bid: number): PmccLegRejection => ({
  role: 'short', occSymbol: null, strike, expiration: '2026-12-04', bid, ask: bid + 0.02,
  reasons: [{ code: 'STRIKE_TOO_CLOSE_TO_PRICE', message: `Strike ${strike} is less than 10% above the $60.13 price` }],
});
const deltaOnly = (strike: number, delta: number, bid: number): PmccLegRejection => ({
  role: 'short', occSymbol: null, strike, expiration: '2026-12-04', bid, ask: bid + 0.02,
  reasons: [{ code: 'DELTA_OUT_OF_RANGE', message: `Short delta ${delta.toFixed(2)} outside 0.20-0.35` }],
});

describe('PMCC-FILTER-CONFLICT-0001', () => {
  it('NFLX Dec 4: names both settings, the closest call and the % that would let it through', () => {
    const result = detectPmccFilterConflict([floorOnly(63, 0.75), floorOnly(64, 0.53), floorOnly(65, 0.37), deltaOnly(67, 0.09, 0.18), deltaOnly(68, 0.07, 0.13)]);
    expect(result).not.toBeNull();
    expect(result!.closestStrike).toBe(65);
    expect(result!.closestBid).toBe(0.37);
    expect(result!.suggestedMinAbovePct).toBe(8);
    expect(result!.line).toContain('10% above-price floor ($66.14)');
    expect(result!.line).toContain('delta 0.20-0.35');
    expect(result!.line).toContain('the $65 call, bid $0.37');
  });
  it('does not fire when only one kind of rejection exists, or when there are none', () => {
    expect(detectPmccFilterConflict([floorOnly(64, 0.5), floorOnly(65, 0.37)])).toBeNull();
    expect(detectPmccFilterConflict([deltaOnly(67, 0.09, 0.18)])).toBeNull();
    expect(detectPmccFilterConflict([])).toBeNull();
    expect(detectPmccFilterConflict(undefined)).toBeNull();
  });
  it('ignores legs that failed for other reasons too (wide spread) when deciding they fit the delta range', () => {
    const wide: PmccLegRejection = { ...floorOnly(63, 0.75), reasons: [...floorOnly(63, 0.75).reasons, { code: 'SPREAD_TOO_WIDE' as never, message: 'Bid/ask spread 10.13% exceeds 10%' }] };
    expect(detectPmccFilterConflict([wide, deltaOnly(67, 0.09, 0.18)])).toBeNull();
  });
});
