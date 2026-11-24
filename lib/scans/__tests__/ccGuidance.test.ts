// lib/scans/__tests__/ccGuidance.test.ts
//
// CC-PMCC-GUIDANCE-0001 slice A fixtures: XYZ (qualified card), ABC (Small & safe), METU-style low pay, and the price-gap
// boundaries. Every number is checked by hand in the build ticket.

import { describe, it, expect } from 'vitest';
import type { CcGrid, CcGridCell } from '../ccGridTypes';
import {
  ccPopPct, ccPopTone, ccPriceGapPct, ccFillLabel, ccExpectedFill, ccAnnualYieldPct, ccPeriodYieldPct, ccCellVerdict,
  pickSmallAndSafe, buildCcCardView, ccEffectiveMinPay, ccMinPayPhrase, ccStrikeLabel, ccExpirationLabel, ccMidTotal,
  CC_HARD_MIN_PAY, CC_SMALL_SAFE_MIN_POP,
} from '../ccGuidance';
import { evaluateHybridSpread } from '../hybridSpread';

function cell(p: Partial<CcGridCell> & { strike: number; delta: number; bid: number; ask: number }): CcGridCell {
  const mid = (p.bid + p.ask) / 2;
  const rule = evaluateHybridSpread(p.bid, p.ask, { rejectPct: 10, warnPct: 5, ceiling: 0.5 }).reject;
  return {
    expiration: '2026-12-11', dte: 25, openInterest: 500, occSymbol: 'X', wide: rule, thinOi: false,
    premiumPerShare: Math.floor(mid * 100 + 1e-9) / 100,
    calledAwayTotal: null, calledAwayPct: null, premiumTotal: 0, notCalledBasis: null,
    ...p,
  } as CcGridCell;
}

const xyz = (cells: CcGridCell[]): CcGrid => ({ basis: 48.1, floor: 52.4, stockPrice: 52.4, contracts: 2, expirations: [{ expiration: '2026-12-11', dte: 25 }], cells, left: { inTheMoney: 0, belowCost: 0, unusableQuote: 0, earnings: 0, farOtm: 0, truncated: 0 } });
const abc = (cells: CcGridCell[]): CcGrid => ({ basis: 36.5, floor: 40, stockPrice: 40, contracts: 1, expirations: [{ expiration: '2026-11-23', dte: 7 }], cells, left: { inTheMoney: 0, belowCost: 0, unusableQuote: 0, earnings: 0, farOtm: 0, truncated: 0 } });

describe('POP', () => {
  it('is (1 - |delta|) x 100, rounded', () => {
    expect(ccPopPct(0.29)).toBe(71);
    expect(ccPopPct(-0.15)).toBe(85);
    expect(ccPopPct(0.07)).toBe(93);
    expect(ccPopPct(1.4)).toBe(0);
  });
  it('colors at the 65 and 55 boundaries', () => {
    expect(ccPopTone(65)).toBe('green'); expect(ccPopTone(64)).toBe('yellow');
    expect(ccPopTone(55)).toBe('yellow'); expect(ccPopTone(54)).toBe('red');
  });
});

describe('price gap and fill label', () => {
  it('measures (ask - bid) / mid', () => {
    expect(ccPriceGapPct(1.04, 1.06)).toBe(1.9);
    expect(ccPriceGapPct(0.3, 0.55)).toBe(58.8);
    expect(ccPriceGapPct(0.14, 0.15)).toBe(6.9);
    expect(ccPriceGapPct(0, 0.5)).toBeNull();
    expect(ccPriceGapPct(0.6, 0.5)).toBeNull();
  });
  it('Good under 5%, OK from 5 to 10%, too big when the rule fails', () => {
    expect(ccFillLabel(cell({ strike: 56, delta: 0.29, bid: 1.04, ask: 1.06 })).label).toBe('good');
    expect(ccFillLabel(cell({ strike: 43, delta: 0.07, bid: 0.14, ask: 0.15 })).label).toBe('ok');
    expect(ccFillLabel(cell({ strike: 58, delta: 0.15, bid: 0.3, ask: 0.55 })).label).toBe('too_big');
  });
  it('the hybrid rule: a gap of 5 cents always passes, just over fails, over 50 cents never passes', () => {
    const rule = (bid: number, ask: number) => evaluateHybridSpread(bid, ask, { rejectPct: 10, warnPct: 5, ceiling: 0.5 }).reject;
    expect(rule(0.2, 0.25)).toBe(false);          // 5 cents on a $0.225 mid is 22%, still passes
    expect(rule(0.2, 0.26)).toBe(true);           // 6 cents on a $0.23 mid fails
    expect(rule(5.0, 5.5)).toBe(false);           // exactly 10% of the mid passes (50 cents, mid 5.25 -> 9.5%)
    expect(rule(10.0, 10.51)).toBe(true);         // over the $0.50 ceiling
  });
});

describe('XYZ qualified card', () => {
  const c56 = cell({ strike: 56, delta: 0.29, bid: 1.04, ask: 1.06 });
  const c58 = cell({ strike: 58, delta: 0.15, bid: 0.3, ask: 0.55 });
  const g = xyz([c56, c58]);
  it('$56C pays $210, 6.9% above, POP 71%, gain if called $1,790, 29% a year, fill Good', () => {
    const v = buildCcCardView({ grid: g, cell: c56, minPay: 25, symbol: 'XYZ' });
    expect(v.verdict).toBe('pick');
    expect(v.headline).toBe('Sell 2 $56C · Exp Dec 11');
    expect(v.collect.big).toBe('$210'); expect(v.collect.sub).toBe('bid $1.04 · mid $1.05 · ask $1.06');
    expect(v.keep.big).toBe('POP 71%'); expect(v.keep.sub).toBe('called only if XYZ rises 6.9%, to $56');
    expect(v.fill.big).toBe('Good'); expect(v.fill.sub).toBe('price gap 2¢ (1.9%) · expect $208 to $210');
    expect(v.why[0]).toBe('If called: shares sold at $56, a gain of $1,790 on your $48.10 cost, including the $210 you collect.');
    expect(v.why[1]).toBe('If not called: you keep the $210 and your cost drops to $47.05 a share.');
    expect(v.why[2]).toBe('Yield: 2.0% in 25 days, about 29% a year.');
    expect(v.canReview).toBe(true); expect(v.tag).toBeNull();
  });
  it('$58C wide: about $60 at the bid, price gap 59%, not a pick, Review order off', () => {
    const v = buildCcCardView({ grid: g, cell: c58, minPay: 25, symbol: 'XYZ' });
    expect(v.verdict).toBe('wide');
    expect(v.headline).toBe('$58C · Exp Dec 11 · not a pick');
    expect(v.collect.big).toBe('About $60');
    expect(v.fill.big).toBe('Price gap too big');
    expect(v.fill.sub).toBe('gap 25¢ = 58.8% of the price, the most allowed is 4¢ · the $85 middle price is not real');
    expect(v.canReview).toBe(false);
    expect(v.reviewOffNote).toBe('Pick a green-outline cell instead.');
    expect(ccMidTotal(g, c58)).toBe(85);
  });
  it('expected fill is bid to premium', () => {
    expect(ccExpectedFill(g, c56)).toEqual({ low: 208, high: 210 });
  });
});

describe('minimum pay', () => {
  it('the chip is Dean\'s setting but nothing under the hard floor is ever recommended, even on Any', () => {
    expect(ccEffectiveMinPay(0)).toBe(CC_HARD_MIN_PAY);
    expect(ccEffectiveMinPay(25)).toBe(25);
    expect(ccMinPayPhrase(0)).toBe('the $10 floor');
    expect(ccMinPayPhrase(25)).toBe('your $25 minimum');
    const tiny = cell({ strike: 44, delta: 0.3, bid: 0.04, ask: 0.05 });  // $4 for one contract
    expect(ccCellVerdict(abc([tiny]), tiny, 0)).toBe('low_pay');
  });
  it('a call paying exactly the minimum is a pick', () => {
    const c = cell({ strike: 42, delta: 0.3, bid: 0.25, ask: 0.26 }); // premium 0.25 -> $25
    expect(ccCellVerdict(abc([c]), c, 25)).toBe('pick');
  });
});

describe('Small & safe (ABC: price 40, basis 36.50, 1 contract, minimum $25)', () => {
  const c43 = cell({ strike: 43, delta: 0.07, bid: 0.14, ask: 0.15, expiration: '2026-11-23', dte: 7 });
  const c44 = cell({ strike: 44, delta: 0.04, bid: 0.11, ask: 0.12, expiration: '2026-11-23', dte: 7 });
  const c42 = cell({ strike: 42, delta: 0.11, bid: 0.2, ask: 0.21, expiration: '2026-11-23', dte: 7 }); // POP 89: not safe enough
  const g = abc([c42, c43, c44]);
  it('picks the highest-paying call with POP 90% or more', () => {
    expect(pickSmallAndSafe(g, 25)).toBe(c43);
  });
  it('POP 89% is excluded and 90% is included', () => {
    expect(ccCellVerdict(g, c42, 25)).toBe('low_pay');
    const c90 = cell({ strike: 43, delta: 0.1, bid: 0.14, ask: 0.15, expiration: '2026-11-23', dte: 7 });
    expect(ccCellVerdict(abc([c90]), c90, 25)).toBe('small_safe');
    expect(CC_SMALL_SAFE_MIN_POP).toBe(90);
  });
  it('ties on pay go to the higher POP', () => {
    const a = cell({ strike: 43, delta: 0.08, bid: 0.14, ask: 0.15, expiration: '2026-11-23', dte: 7 });
    const b = cell({ strike: 44, delta: 0.05, bid: 0.14, ask: 0.15, expiration: '2026-11-23', dte: 7 });
    expect(pickSmallAndSafe(abc([a, b]), 25)).toBe(b);
  });
  it('never offered when a call meets the minimum, and never a wide call', () => {
    const pays = cell({ strike: 41, delta: 0.3, bid: 0.3, ask: 0.31, expiration: '2026-11-23', dte: 7 });
    expect(ccCellVerdict(abc([pays]), pays, 25)).toBe('pick');
    const wideSafe = cell({ strike: 45, delta: 0.03, bid: 0.05, ask: 0.2, expiration: '2026-11-23', dte: 7 });
    expect(wideSafe.wide).toBe(true);
    expect(pickSmallAndSafe(abc([wideSafe]), 25)).toBeNull();
  });
  it('card wording: $43C Exp Nov 23, $14, POP 93%, fill OK, yield about 18% a year, gain if called $664', () => {
    const v = buildCcCardView({ grid: g, cell: c43, minPay: 25, symbol: 'ABC', autoSmallSafe: true });
    expect(v.verdict).toBe('small_safe');
    expect(v.tag).toBe('SMALL & SAFE');
    expect(v.headline).toBe('Sell 1 $43C · Exp Nov 23');
    expect(v.note).toBe('Nothing pays $25. Best call with POP 90%+ above your cost.');
    expect(v.collect.big).toBe('$14'); expect(v.collect.sub).toBe('bid $0.14 · mid $0.14 · ask $0.15');
    expect(v.keep.big).toBe('POP 93%'); expect(v.keep.sub).toBe('called only if ABC rises 7.5%, to $43');
    expect(v.fill.big).toBe('OK'); expect(v.fill.sub).toBe('price gap 1¢ (6.9%) · expect about $14');
    expect(v.why[0]).toBe('If called: shares sold at $43, a gain of $664 on your $36.50 cost, including the $14 you collect.');
    expect(v.why[2]).toBe('Yield: 0.4% in 7 days, about 18% a year.');
    expect(v.canReview).toBe(true);
  });
});

describe('yield and labels', () => {
  it('period and annual yield', () => {
    expect(ccPeriodYieldPct(1.05, 52.4)).toBe(2);
    expect(ccAnnualYieldPct(1.05, 52.4, 25)).toBe(29);
    expect(ccAnnualYieldPct(1.05, null, 25)).toBeNull();
    expect(ccAnnualYieldPct(1.05, 52.4, 0)).toBeNull();
  });
  it('strike and expiration labels', () => {
    expect(ccStrikeLabel(56)).toBe('$56C');
    expect(ccStrikeLabel(56.5)).toBe('$56.50C');
    expect(ccExpirationLabel('2026-12-11')).toBe('Dec 11');
  });
});

import { ccStartingLimit, ccLimitFloor } from '@/features/screener/components/CcTradeModal';
import { ccBasisText } from '@/features/screener/components/CcBasisLine';

describe('order dialog limit (Ian): mid rounded down to the cent, never below the bid, penny steps', () => {
  it('starts at the mid floored to the cent', () => {
    expect(ccStartingLimit({ midPerShare: 1.05, bidPerShare: 1.04, wide: false })).toBe(1.05);
    expect(ccStartingLimit({ midPerShare: 0.145, bidPerShare: 0.14, wide: false })).toBe(0.14);
    expect(ccStartingLimit({ midPerShare: 1.059, bidPerShare: 1.04, wide: false })).toBe(1.05);
  });
  it('never below the bid; a wide call starts at the bid', () => {
    expect(ccStartingLimit({ midPerShare: 0.4, bidPerShare: 0.45, wide: false })).toBe(0.45);
    expect(ccStartingLimit({ midPerShare: 0.42, bidPerShare: 0.3, wide: true })).toBe(0.3);
    expect(ccLimitFloor({ bidPerShare: 0.3 })).toBe(0.3);
    expect(ccLimitFloor({ bidPerShare: undefined })).toBe(0.01);
  });
});

describe('R3 basis line', () => {
  it('shows the basis and its source, and says no call without one', () => {
    expect(ccBasisText({ basis: 48.1, source: 'adjusted' })).toBe('Cost basis $48.10 (after put premium)');
    expect(ccBasisText({ basis: 80, source: 'typed' })).toBe('Cost basis $80.00 (typed by you)');
    expect(ccBasisText({ basis: 80, source: 'broker' })).toBe('Cost basis $80.00 (broker)');
    expect(ccBasisText({ basis: null, source: null })).toBe('Cost basis unknown. No call without one.');
    expect(ccBasisText(undefined)).toBe('Cost basis unknown. No call without one.');
  });
});

import { ccGapLimitCents, ccIfCalledLabel, ccTimingNote, ccOutsideTheView, ccGoalPopRange } from '../ccGuidance';

describe('stock card and scan row timing (METU: price 21.97, basis 26.94, RSI 42, cutoff 50)', () => {
  it('Wait: RSI under the cutoff, then price below cost', () => {
    const n = ccTimingNote({ symbol: 'METU', rsi: 42, price: 21.97, basis: 26.94, cutoff: 50 });
    expect(n.chip).toBe('Wait');
    expect(n.title).toBe('NO CALL YET');
    expect(n.lines).toEqual([
      'Wait for RSI 50 (now 42).',
      'Price is 18.4% below cost.',
    ]);
  });
  it('Recovery: RSI fine but price below cost', () => {
    const n = ccTimingNote({ symbol: 'METU', rsi: 55, price: 21.97, basis: 26.94, cutoff: 50 });
    expect(n.chip).toBe('Recovery');
    expect(n.lines).toEqual(['Price is 18.4% below cost.']);
  });
  it('Ready: nothing to warn about', () => {
    const n = ccTimingNote({ symbol: 'XYZ', rsi: 60, price: 52.4, basis: 48.1, cutoff: 50 });
    expect(n.chip).toBe('Ready'); expect(n.title).toBeNull(); expect(n.lines).toEqual([]);
  });
  it('unknown RSI fails closed to Wait with its own sentence', () => {
    expect(ccTimingNote({ symbol: 'X', rsi: null, price: 10, basis: 8, cutoff: 50 }).lines[0]).toBe('RSI unavailable, timing unconfirmed.');
  });
});

describe('calls outside your view', () => {
  const mk = (strike: number, delta: number, bid: number, ask: number) => cell({ strike, delta, bid, ask, expiration: '2026-12-04', dte: 18 });
  const g: CcGrid = { ...xyz([mk(27, 0.11, 0.23, 0.24), mk(28, 0.08, 0.2, 0.21), mk(30, 0.3, 0.31, 0.52), mk(26, 0.3, 0.5, 0.52)]), basis: 26.94, stockPrice: 21.97, floor: 26.94 };
  it('balanced wants POP 65 to 80%', () => { expect(ccGoalPopRange('balanced')).toEqual({ lo: 65, hi: 80 }); });
  it('lists too-high POP and too-wide calls with a plain reason, leaves in-view calls out', () => {
    const rows = ccOutsideTheView(g, 'balanced');
    expect(rows.map(r => r.cell.strike)).toEqual([27, 28, 30]);
    expect(rows[0].why).toBe('Strike too far above the price: POP 89%, your view wants 65 to 80%');
    expect(rows[2].why).toBe('Price gap 21¢, the most allowed here is 4¢');
  });
});

describe('METU $27C Dec 4 (matches TastyTrade: bid 0.15, mid 0.40, ask 0.65)', () => {
  it('shows bid, mid and ask on the card; price gap 125%', () => {
    const c = cell({ strike: 27, delta: 0.15, bid: 0.15, ask: 0.65, expiration: '2026-12-04', dte: 18 });
    const g = abc([c]);
    const v = buildCcCardView({ grid: g, cell: c, minPay: 25, symbol: 'METU' });
    expect(v.collect.sub).toBe('the bid price · bid $0.15 · mid $0.40 · ask $0.65');
    expect(ccPriceGapPct(0.15, 0.65)).toBe(125);
  });
});

describe('the most gap allowed: the larger of 5 cents and 10% of the mid', () => {
  it('cheap options allow 5 cents; pricier ones allow 10%; never over 50 cents', () => {
    expect(ccGapLimitCents(0.1, 0.4)).toBe(2);     // mid 0.25 -> 2.5 cents, rounds down to 2
    expect(ccGapLimitCents(0.5, 0.85)).toBe(6);    // mid 0.675 -> 6.75 cents, rounds down to 6
    expect(ccGapLimitCents(2.0, 2.4)).toBe(22);    // mid 2.20 -> 22 cents
    expect(ccGapLimitCents(9.0, 11.0)).toBe(50);   // mid 10 -> 100 cents, capped at 50
  });
});

describe('total if called, outside-view table', () => {
  const g = { ...xyz([]), basis: 26.94, contracts: 1 } as CcGrid;
  it('adds what the shares gain to the premium collected', () => {
    expect(ccIfCalledLabel(g, { strike: 28 }, 35)).toBe('+$141 ($106 on the shares + $35 collected)');
  });
  it('a dash when the basis is unknown', () => {
    expect(ccIfCalledLabel({ ...g, basis: null }, { strike: 28 }, 35)).toBe('—');
  });
});
