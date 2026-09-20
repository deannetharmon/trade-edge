// lib/leaps-position-intelligence/__tests__/cycleCard.test.ts
//
// LEAPS-POS-0002 -- the open-cycle card. Worked example: GOOGL 250C held for $113.55 (mark $120.45, stock $350.86, delta 0.85), with
// a $375 call sold for $6.40, now $2.43 (delta 0.18), 21 days left.

import { describe, expect, it } from 'vitest';
import { buildCycleCard, CYCLE_CARD_POLICY, type CycleShortCall } from '../cycleCard';
import type { IncomeCardLongCall } from '../incomeCard';

const longCall = (over: Partial<IncomeCardLongCall> = {}): IncomeCardLongCall => ({ strike: 250, dte: 270, quantity: 1, entryDebitPerShare: 113.55, markPerShare: 120.45, delta: 0.85, stockPrice: 350.86, ...over });
const short = (over: Partial<CycleShortCall> = {}): CycleShortCall => ({ strike: 375, dte: 21, quantity: 1, soldPerShare: 6.4, markPerShare: 2.43, delta: 0.18, ...over });
const card = (l: Partial<IncomeCardLongCall> = {}, s: Partial<CycleShortCall> = {}) => buildCycleCard({ longCall: longCall(l), short: short(s) });
const t = (tiles: ReturnType<typeof card>['shortTiles'], id: string) => tiles.find(x => x.id === id)!;
const callout = (c: ReturnType<typeof card>, id: string) => c.callouts.find(x => x.id === id);

describe('the worked example', () => {
  const c = card();

  it('short call tiles', () => {
    expect(c.shortTiles.map(x => [x.id, x.value, x.tone])).toEqual([['captured', '62%', 'good'], ['dte', '21', 'watch'], ['room', '6.9%', 'good'], ['if-assigned', '+$1,785', 'good']]);
    expect(t(c.shortTiles, 'captured').parts[0].text).toBe('sold $6.40 · now $2.43');
    expect(t(c.shortTiles, 'room').parts[0].text).toBe('below $375 strike');
    expect(t(c.shortTiles, 'dte').parts[0].text).toBe('roll window opens at 21 days');
  });

  it('long LEAPS tiles', () => {
    expect(c.longTiles.map(x => [x.id, x.value, x.tone])).toEqual([['value', '$12,045', 'neutral'], ['breakeven', '$363.55', 'watch'], ['net-delta', '0.67', 'neutral'], ['income', '+$397', 'good']]);
    expect(t(c.longTiles, 'net-delta').parts[0].text).toBe('0.85 long − 0.18 short');
  });

  it('callouts: the open window first, then the good news', () => {
    expect(c.callouts.map(x => [x.id, x.tone])).toEqual([['window', 'watch'], ['captured', 'good'], ['floor', 'good']]);
    expect(callout(c, 'captured')!.text).toBe('62% of the credit is captured: past your 50% review point.');
    expect(callout(c, 'window')!.text).toBe('21 days left: your roll-or-close window is open.');
    expect(callout(c, 'floor')!.text).toBe('The short strike is still 3.1% above your LEAPS breakeven at expiry.');
    expect(c.windowOpen).toBe(true);
  });
});

describe('thresholds (Ian, editable defaults)', () => {
  it('pins the policy values', () => {
    expect(CYCLE_CARD_POLICY).toEqual({ captureReviewPct: 50, rollWindowDte: 21, nearStrikePct: 3 });
  });

  it.each([[3.21, false], [3.2, true]])('sold 6.40, now %s: at-or-past 50%% captured is %s', (mark, reached) => {
    expect(Boolean(callout(card({}, { markPerShare: mark }), 'captured'))).toBe(reached);
  });

  it.each([[22, false], [21, true]])('%s days left: roll window open %s', (dte, open) => {
    const c = card({}, { dte });
    expect(c.windowOpen).toBe(open);
    expect(t(c.shortTiles, 'dte').tone).toBe(open ? 'watch' : 'neutral');
    expect(Boolean(callout(c, 'window'))).toBe(open);
  });

  it('a call worth more than it was sold for is amber, with how much more', () => {
    const c = card({}, { markPerShare: 9.6 });
    expect(t(c.shortTiles, 'captured')).toMatchObject({ value: '-50%', tone: 'watch' });
    expect(callout(c, 'captured')!.text).toBe('The call is worth 50% more than you sold it for.');
  });
});

describe('the stock against the short strike', () => {
  it('room of 3% or more is green; under 3% is amber with the early-assignment note', () => {
    expect(t(card({ stockPrice: 364 }).shortTiles, 'room').tone).toBe('good');          // 375/364 = +3.02%
    const near = card({ stockPrice: 366 });                                               // 375/366 = +2.46%
    expect(t(near.shortTiles, 'room').tone).toBe('watch');
    expect(callout(near, 'room')).toMatchObject({ tone: 'watch', text: 'Stock is only 2.5% below the short strike.' });
    expect(callout(near, 'events')!.tone).toBe('watch');
  });

  it('a stock at or above the strike is red: the call is in the money', () => {
    for (const stockPrice of [375, 380]) {
      const c = card({ stockPrice });
      expect(t(c.shortTiles, 'room')).toMatchObject({ tone: 'bad' });
      expect(t(c.shortTiles, 'room').parts[0].text).toBe('at or above $375 strike');
      expect(c.callouts[0]).toMatchObject({ id: 'room', tone: 'bad' });
    }
  });

  it('plenty of room shows no events note', () => {
    expect(callout(card(), 'events')).toBeUndefined();
  });
});

describe('breakeven floor and if-assigned', () => {
  it('a short strike below the breakeven is red', () => {
    const c = card({}, { strike: 360 });
    expect(callout(c, 'floor')).toMatchObject({ tone: 'bad', text: 'The short strike is below your LEAPS breakeven: an assignment would lock in a loss.' });
    expect(c.callouts[0].id).toBe('floor');
  });

  it('if assigned is strike width less net debit and can be a loss', () => {
    expect(t(card({}, { strike: 300, soldPerShare: 1 }).shortTiles, 'if-assigned')).toMatchObject({ value: '-$6,255', tone: 'bad' });
  });
});

describe('gaps and shapes', () => {
  it('missing sold price gives dashes and no invented capture', () => {
    const c = card({}, { soldPerShare: null });
    expect(t(c.shortTiles, 'captured').value).toBe('—');
    expect(t(c.shortTiles, 'if-assigned').value).toBe('—');
    expect(t(c.longTiles, 'income').value).toBe('—');
  });

  it('missing entry cost keeps the capture but drops breakeven and if-assigned, and says so', () => {
    const c = card({ entryDebitPerShare: null });
    expect(t(c.shortTiles, 'captured').value).toBe('62%');
    expect(t(c.shortTiles, 'if-assigned').value).toBe('—');
    expect(t(c.longTiles, 'breakeven').value).toBe('—');
    expect(callout(c, 'entry')!.tone).toBe('watch');
    expect(callout(c, 'floor')).toBeUndefined();
  });

  it('missing stock price shows no room and no room callouts', () => {
    const c = card({ stockPrice: null });
    expect(t(c.shortTiles, 'room')).toMatchObject({ value: '—', tone: 'neutral' });
    expect(callout(c, 'room')).toBeUndefined();
  });

  it('missing deltas give a dash for net delta', () => {
    expect(t(card({ delta: null }).longTiles, 'net-delta').value).toBe('—');
    expect(t(card({}, { delta: null }).longTiles, 'net-delta').value).toBe('—');
  });

  it('scales with contracts (income and if-assigned)', () => {
    const c = card({ quantity: 2 }, { quantity: 2 });
    expect(t(c.longTiles, 'income').value).toBe('+$794');
    expect(t(c.shortTiles, 'if-assigned').value).toBe('+$3,570');
  });

  it('never mutates its input', () => {
    const l = longCall(); const s = short();
    const before = JSON.stringify([l, s]);
    buildCycleCard({ longCall: l, short: s });
    expect(JSON.stringify([l, s])).toBe(before);
  });
});
