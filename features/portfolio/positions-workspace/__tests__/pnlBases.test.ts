// features/portfolio/positions-workspace/__tests__/pnlBases.test.ts
//
// PNL-BASIS-0001 -- fixtures are Dean's own positions from the 2026-09-20 screenshots (after hours, wide quotes).

import { describe, expect, it } from 'vitest';
import { buildPnlReconciliation, buildPnlSecondLine, buildPositionPnlBases, describePnlReconciliation, WIDE_MARKET_PCT, wideMarketNote } from '../model/pnlBases';

type P = Parameters<typeof buildPositionPnlBases>[0];
const debit = (entryCredit: number, closeValue: number, currentValue: number, pnl: number, over: Partial<P> = {}): P => ({
  entryPriceEffect: 'Debit', entryEconomicsComplete: true, entryCredit, closeValue, currentValue, pnl, closeNowPnl: null, targetPrice: 0, ...over,
});
const MRNA = debit(2574, 1290, 1330, -1244);
const UBER = debit(2130, 1360, 1425, -705);
const NFLX = debit(2085, 1350, 1363, -723);
const MRVL: P = { entryPriceEffect: 'Credit', entryEconomicsComplete: true, entryCredit: 442, closeValue: 280, currentValue: 243, pnl: 199, closeNowPnl: 162, targetPrice: 221 };
const META = { unrealizedPnl: 596 };
const SNDK = { unrealizedPnl: 412 };

describe('buildPositionPnlBases', () => {
  it('a credit spread keeps its own close-now P/L as primary and the midpoint as the other basis', () => {
    expect(buildPositionPnlBases(MRVL)).toEqual({ kind: 'credit', mid: 199, closeNow: 162, closeNowDerived: false, primary: 'close-now', entryAmount: 442, targetProfit: 221 });
  });

  it('a long option keeps the midpoint as primary (unchanged) and derives close-now as liquidation less what was paid', () => {
    expect(buildPositionPnlBases(MRNA)).toEqual({ kind: 'debit', mid: -1244, closeNow: -1284, closeNowDerived: true, primary: 'mid', entryAmount: 2574, targetProfit: null });
    expect(buildPositionPnlBases(UBER).closeNow).toBe(-770);
    expect(buildPositionPnlBases(NFLX).closeNow).toBe(-735);
  });

  it('the position\'s own closeNowPnl is never overridden by the derived figure', () => {
    expect(buildPositionPnlBases({ ...MRNA, closeNowPnl: -1290 })).toMatchObject({ closeNow: -1290, closeNowDerived: false, primary: 'close-now' });
  });

  it('derives nothing without a liquidation value, without complete entry economics, or for a credit position without its own close-now', () => {
    expect(buildPositionPnlBases({ ...MRNA, closeValue: null }).closeNow).toBeNull();
    expect(buildPositionPnlBases({ ...MRNA, entryEconomicsComplete: false })).toMatchObject({ closeNow: null, entryAmount: null });
    expect(buildPositionPnlBases({ ...MRVL, closeNowPnl: null })).toMatchObject({ closeNow: null, primary: 'mid' });
    expect(buildPositionPnlBases({ ...MRNA, entryPriceEffect: undefined as unknown as 'Debit' })).toMatchObject({ kind: 'unknown', closeNow: null });
  });

  it('a target exists only for a credit position with complete economics and a positive target', () => {
    expect(buildPositionPnlBases({ ...MRVL, entryEconomicsComplete: false }).targetProfit).toBeNull();
    expect(buildPositionPnlBases({ ...MRVL, targetPrice: 0 }).targetProfit).toBeNull();
    expect(buildPositionPnlBases({ ...MRVL, targetPrice: Number.NaN }).targetProfit).toBeNull();
  });

  it('non-finite values are treated as missing', () => {
    expect(buildPositionPnlBases({ ...MRNA, pnl: Number.NaN }).mid).toBeNull();
  });
});

describe('the second line (the other basis, labelled)', () => {
  it('MRVL: primary is close-now, so the line shows the midpoint and how far that is toward the 50% target ($199 of $221)', () => {
    expect(buildPnlSecondLine(buildPositionPnlBases(MRVL))).toEqual({ label: 'Mid', text: 'Mid +$199 · 90% of target' });
  });

  it('long options show close-now with the loss on what was paid', () => {
    expect(buildPnlSecondLine(buildPositionPnlBases(MRNA))!.text).toBe('Close now -$1,284 (-49.9%)');
    expect(buildPnlSecondLine(buildPositionPnlBases(UBER))!.text).toBe('Close now -$770 (-36.2%)');
    expect(buildPnlSecondLine(buildPositionPnlBases(NFLX))!.text).toBe('Close now -$735 (-35.3%)');
  });

  it('a credit position without a target shows the midpoint without a percentage', () => {
    expect(buildPnlSecondLine(buildPositionPnlBases({ ...MRVL, entryEconomicsComplete: false }))!.text).toBe('Mid +$199');
    expect(buildPnlSecondLine(buildPositionPnlBases({ ...MRVL, targetPrice: 0 }))!.text).toBe('Mid +$199');
  });

  it('nothing to add when the bases agree (within 50 cents) or one is unavailable', () => {
    expect(buildPnlSecondLine(buildPositionPnlBases(debit(2574, 1330.2, 1330, -1244)))).toBeNull();
    expect(buildPnlSecondLine(buildPositionPnlBases({ ...MRNA, closeValue: null }))).toBeNull();
    expect(buildPnlSecondLine(buildPositionPnlBases({ ...MRVL, pnl: null as unknown as number }))).toBeNull();
  });
});

describe('the wide-market note', () => {
  it('pins the threshold', () => { expect(WIDE_MARKET_PCT).toBe(5); });

  it('flags MRVL: closing now costs $37 more than the mid, 15% of its $243 value', () => {
    expect(wideMarketNote(buildPositionPnlBases(MRVL), 243)).toBe('Wide market: closing now costs $37 more than the mid.');
  });

  it('does not flag MRNA (3.0%), NFLX (0.9%) or UBER (4.6%)', () => {
    expect(wideMarketNote(buildPositionPnlBases(MRNA), 1330)).toBeNull();
    expect(wideMarketNote(buildPositionPnlBases(NFLX), 1363)).toBeNull();
    expect(wideMarketNote(buildPositionPnlBases(UBER), 1425)).toBeNull();
  });

  it('exactly 5% is not flagged; just over is, and a long option says selling brings less', () => {
    // mid value 1000: a gap of $50 is exactly 5%
    expect(wideMarketNote(buildPositionPnlBases(debit(1500, 950, 1000, -500)), 1000)).toBeNull();
    expect(wideMarketNote(buildPositionPnlBases(debit(1500, 949, 1000, -500)), 1000)).toBe('Wide market: selling now brings $51 less than the mid.');
  });

  it('is silent when close-now is not worse, or a value is missing', () => {
    expect(wideMarketNote({ ...buildPositionPnlBases(MRVL), closeNow: 210 }, 243)).toBeNull();
    expect(wideMarketNote(buildPositionPnlBases(MRVL), 0)).toBeNull();
    expect(wideMarketNote(buildPositionPnlBases(MRVL), null)).toBeNull();
    expect(wideMarketNote(buildPositionPnlBases({ ...MRNA, closeValue: null }), 1330)).toBeNull();
  });
});

describe('reconciling the analysis table with the Portfolio view', () => {
  const options = [MRNA, MRVL, NFLX, UBER];
  const r = buildPnlReconciliation({ options, equities: [META, SNDK], portfolioTotal: -1465 });

  it('adds up Dean\'s numbers: options -$2,473 at mid, -$2,627 at close-now, equities +$1,008, all -$1,465', () => {
    expect(r).toMatchObject({ optionCount: 4, optionsMid: -2473, optionsCloseNow: -2627, equityCount: 2, equitiesPnl: 1008, totalMid: -1465, portfolioTotal: -1465, reconciles: true });
  });

  it('describes it in one line, including that the totals match', () => {
    expect(describePnlReconciliation(r)).toEqual({
      tone: 'ok',
      line: 'Options in this table: mid -$2,473 · close-now -$2,627  ·  2 equity holdings not shown here: +$1,008  ·  All positions at mid: -$1,465 · matches the Portfolio view',
    });
  });

  it('warns, with the size of the difference, when the two totals do not agree', () => {
    const off = describePnlReconciliation(buildPnlReconciliation({ options, equities: [META, SNDK], portfolioTotal: -1400 }));
    expect(off.tone).toBe('warn');
    expect(off.line).toContain("The Portfolio view's total is -$1,400: the two differ by $65");
    expect(off.line).not.toContain('matches the Portfolio view');
  });

  it('a difference under $1 still reconciles', () => {
    expect(buildPnlReconciliation({ options, equities: [META, SNDK], portfolioTotal: -1465.4 }).reconciles).toBe(true);
  });

  it('an unpriced option or equity leaves that total out instead of guessing', () => {
    const partial = buildPnlReconciliation({ options: [MRNA, { ...MRVL, pnl: null as unknown as number }], equities: [META, { unrealizedPnl: null }], portfolioTotal: null });
    expect(partial).toMatchObject({ optionsMid: null, optionsMidMissing: 1, equitiesPnl: null, equitiesUnpriced: 1, totalMid: null, reconciles: null });
    const text = describePnlReconciliation(partial).line;
    expect(text).toContain('mid n/a (1 unpriced)');
    expect(text).toContain('partial (1 unpriced)');
    expect(text).not.toContain('All positions at mid');
  });

  it('close-now is left out when any option has none', () => {
    const noNow = buildPnlReconciliation({ options: [MRNA, { ...MRVL, closeNowPnl: null }], equities: [], portfolioTotal: null });
    expect(noNow.optionsCloseNow).toBeNull();
    expect(noNow.optionsCloseNowMissing).toBe(1);
    expect(describePnlReconciliation(noNow).line).toContain('close-now n/a for 1');
  });

  it('with no equities the equities part is omitted and the total is the options at mid', () => {
    const none = buildPnlReconciliation({ options, equities: [], portfolioTotal: -2473 });
    expect(none).toMatchObject({ equityCount: 0, equitiesPnl: 0, totalMid: -2473, reconciles: true });
    expect(describePnlReconciliation(none).line).not.toContain('equity');
  });

  it('with only equities the line shows them and their total', () => {
    const only = buildPnlReconciliation({ options: [], equities: [META, SNDK], portfolioTotal: 1008 });
    expect(only).toMatchObject({ optionCount: 0, optionsMid: null, totalMid: 1008, reconciles: true });
    expect(describePnlReconciliation(only).line).toBe('1 equity holding not shown here'.replace('1 equity holding', '2 equity holdings') + ': +$1,008  ·  All positions at mid: +$1,008 · matches the Portfolio view');
  });

  it('with nothing at all there is nothing to say', () => {
    expect(describePnlReconciliation(buildPnlReconciliation({ options: [], equities: [], portfolioTotal: null })).line).toBe('');
  });
});
