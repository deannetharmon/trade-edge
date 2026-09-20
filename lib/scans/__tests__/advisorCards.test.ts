// lib/scans/__tests__/advisorCards.test.ts
//
// LEAPS-DASH-0004 -- Covered Call and PMCC advisor pick cards: tiles and callouts by rule.

import { describe, expect, it } from 'vitest';
import { ADVISOR_CARD_POLICY, buildCcPickSummary, buildPmccPickSummary, type CcPickInput, type PmccPickInput } from '../advisorCards';

const cc = (over: Partial<CcPickInput> = {}): CcPickInput => ({ strike: 230, dte: 30, delta: 0.28, premiumPerContract: 215, annualizedYieldPct: 14.2, strikeVsStockPct: 6.5, strikeVsCostBasisPct: 8.1, ...over });
const pmcc = (over: Partial<PmccPickInput> = {}): PmccPickInput => ({ shortStrike: 375, shortDte: 30, shortDelta: 0.28, shortCredit: 6.4, shortSpreadPct: 3.1, underlyingPrice: 350.86, netDebitPerShare: 107.15, strikeWidth: 125, widthMinusDebitPerShare: 17.85, ...over });
const ids = (s: { callouts: Array<{ id: string; tone: string }> }) => s.callouts.map(c => [c.id, c.tone]);

describe('policy', () => {
  it('pins the values (and keeps the spread threshold aligned with the LEAPS dashboard)', () => {
    expect(ADVISOR_CARD_POLICY).toEqual({ nearStrikePct: 3, spreadWatchPct: 5 });
  });
});

describe('Covered Call pick', () => {
  it('a healthy pick: five tiles, good cost-basis callout', () => {
    const s = buildCcPickSummary(cc());
    expect(s.tiles.map(t => [t.id, t.value, t.tone])).toEqual([['premium', '$215', 'neutral'], ['yield', '14.2%', 'neutral'], ['delta', '0.28', 'neutral'], ['dte', '30', 'neutral'], ['room', '+6.5%', 'neutral']]);
    expect(ids(s)).toEqual([['cost-basis', 'good']]);
    expect(s.callouts[0].text).toBe('Strike is 8.1% above your cost basis.');
  });

  it('a strike below your cost basis is red and leads', () => {
    const s = buildCcPickSummary(cc({ strikeVsCostBasisPct: -2.5 }));
    expect(s.callouts[0]).toEqual({ id: 'cost-basis', tone: 'bad', text: 'Strike is 2.5% below your cost basis: an assignment would lock in a loss.' });
  });

  it.each([[3, 'neutral', false], [2.99, 'watch', true], [0.5, 'watch', true]])('room %s%% -> tile %s, near-strike callout %s', (room, tone, callout) => {
    const s = buildCcPickSummary(cc({ strikeVsStockPct: room }));
    expect(s.tiles.find(t => t.id === 'room')!.tone).toBe(tone);
    expect(s.callouts.some(c => c.id === 'room')).toBe(callout);
  });

  it('a strike at or below the stock is in the money (red)', () => {
    for (const room of [0, -1.2]) {
      const s = buildCcPickSummary(cc({ strikeVsStockPct: room }));
      expect(s.tiles.find(t => t.id === 'room')!.tone).toBe('bad');
      expect(s.callouts.find(c => c.id === 'room')).toMatchObject({ tone: 'bad', text: 'Strike is at or below the stock: the call is in the money.' });
    }
  });

  it('missing data gives dashes and no invented callouts', () => {
    const s = buildCcPickSummary(cc({ delta: null, premiumPerContract: null, annualizedYieldPct: null, strikeVsStockPct: null, strikeVsCostBasisPct: null }));
    expect(s.tiles.map(t => t.value)).toEqual(['—', '—', '—', '30', '—']);
    expect(s.callouts).toEqual([]);
  });
});

describe('PMCC pick', () => {
  it('the worked example: credit per contract, debit as a share of the width, max profit callout', () => {
    const s = buildPmccPickSummary(pmcc());
    expect(s.tiles.map(t => [t.id, t.value, t.tone])).toEqual([['credit', '$640', 'neutral'], ['delta', '0.28', 'neutral'], ['dte', '30', 'neutral'], ['debit-width', '86%', 'neutral'], ['spread', '3.1%', 'neutral']]);
    expect(ids(s)).toEqual([['max-profit', 'good']]);
    expect(s.callouts[0].text).toBe('Max profit at the short strike is $1,785 a contract (strike width less net debit).');
  });

  it.each([[5, false], [5.1, true]])('spread %s%% -> callout %s', (shortSpreadPct, shown) => {
    const s = buildPmccPickSummary(pmcc({ shortSpreadPct }));
    expect(s.callouts.some(c => c.id === 'spread')).toBe(shown);
    expect(s.tiles.find(t => t.id === 'spread')!.tone).toBe(shown ? 'watch' : 'neutral');
  });

  it('a debit at or above the width has no profit (red)', () => {
    const s = buildPmccPickSummary(pmcc({ netDebitPerShare: 125, widthMinusDebitPerShare: 0 }));
    expect(s.callouts[0]).toMatchObject({ id: 'max-profit', tone: 'bad' });
  });

  it('room to the short strike: near is amber, in the money is red, plenty is silent, unknown price is silent', () => {
    expect(ids(buildPmccPickSummary(pmcc({ underlyingPrice: 366 })))).toEqual([['room', 'watch'], ['max-profit', 'good']]);   // 375/366 = +2.46%
    expect(ids(buildPmccPickSummary(pmcc({ underlyingPrice: 380 })))[0]).toEqual(['room', 'bad']);
    expect(buildPmccPickSummary(pmcc({ underlyingPrice: 350.86 })).callouts.some(c => c.id === 'room')).toBe(false);
    expect(buildPmccPickSummary(pmcc({ underlyingPrice: null })).callouts.some(c => c.id === 'room')).toBe(false);
  });

  it('missing pair metrics give dashes and no profit callout', () => {
    const s = buildPmccPickSummary(pmcc({ netDebitPerShare: null, strikeWidth: null, widthMinusDebitPerShare: null, shortSpreadPct: null }));
    expect(s.tiles.map(t => t.value)).toEqual(['$640', '0.28', '30', '—', '—']);
    expect(s.callouts).toEqual([]);
  });
});
