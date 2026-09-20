// lib/leaps-position-intelligence/__tests__/incomeCard.test.ts
//
// LEAPS-POS-0001 -- the Positions "PMCC income" card numbers. Worked example: a GOOGL 250C 2027-06-17 held for
// $113.55 (mark $120.45, stock $350.86, delta 0.85) with a candidate short call $375 for $6.40 (delta 0.28).

import { describe, expect, it } from 'vitest';
import { buildIncomeCard, type IncomeCardCandidate, type IncomeCardLongCall } from '../incomeCard';
import { applyMandateGates } from '../mandateGates';
import type { LeapsMandate } from '../types';

const longCall = (over: Partial<IncomeCardLongCall> = {}): IncomeCardLongCall => ({
  strike: 250, dte: 270, quantity: 1, entryDebitPerShare: 113.55, markPerShare: 120.45, delta: 0.85, stockPrice: 350.86, ...over,
});
const candidate = (over: Partial<IncomeCardCandidate> = {}): IncomeCardCandidate => ({ strike: 375, dte: 24, delta: 0.28, credit: 6.4, spreadPct: 3.1, openInterest: 500, ...over });
const card = (l: Partial<IncomeCardLongCall> = {}, c: Partial<IncomeCardCandidate> | null = {}) => buildIncomeCard({ longCall: longCall(l), candidate: c === null ? null : candidate(c) });
const tile = (tiles: ReturnType<typeof card>['longTiles'], id: string) => tiles.find(t => t.id === id)!;
const callout = (c: ReturnType<typeof card>, id: string) => c.callouts.find(x => x.id === id);

describe('the worked example', () => {
  const c = card();

  it('long LEAPS tiles', () => {
    expect(c.longTiles.map(t => [t.id, t.value, t.tone])).toEqual([['value', '$12,045', 'neutral'], ['breakeven', '$363.55', 'watch'], ['dte', '270', 'neutral'], ['delta', '0.85', 'neutral']]);
    expect(tile(c.longTiles, 'value').parts).toEqual([{ text: '+$690 · +6.1% vs paid', tone: 'good' }]);
    expect(tile(c.longTiles, 'breakeven').parts[0].text).toBe('+3.6% above stock');
    expect(tile(c.longTiles, 'dte').parts[0].text).toBe('review point 180 days');
  });

  it('income call tiles', () => {
    expect(c.candidateTiles.map(t => [t.id, t.value, t.tone])).toEqual([['credit', '$640', 'neutral'], ['short-strike', '$375', 'good'], ['if-assigned', '+$1,785', 'good'], ['delta-kept', '0.57', 'neutral']]);
    expect(tile(c.candidateTiles, 'credit').parts[0].text).toBe('5.6% of LEAPS cost');
    expect(tile(c.candidateTiles, 'short-strike').parts[0].text).toBe('+3.1% above breakeven');
    expect(tile(c.candidateTiles, 'delta-kept').parts[0].text).toBe('0.85 long − 0.28 short');
  });

  it('callouts: the unchecked events note first, then the good news', () => {
    expect(c.callouts.map(x => [x.id, x.tone])).toEqual([['events', 'watch'], ['floor', 'good'], ['extrinsic-carry', 'good']]);
    expect(callout(c, 'floor')!.text).toBe('Short strike clears your LEAPS breakeven at expiration.');
    expect(callout(c, 'extrinsic-carry')!.text).toBe("Credit is 2.9× the LEAPS's extrinsic value per month (if price is flat).");
    expect(callout(c, 'events')!.text).toContain('not checked here yet');
  });
});

describe('breakeven floor (Ian)', () => {
  it('a strike exactly at the breakeven clears it; one cent below does not', () => {
    expect(callout(card({}, { strike: 363.55 }), 'floor')!.tone).toBe('good');
    const below = card({}, { strike: 363.54 });
    expect(callout(below, 'floor')).toMatchObject({ tone: 'bad', text: 'Short strike is below your LEAPS breakeven: an assignment would lock in a loss.' });
    expect(tile(below.candidateTiles, 'short-strike').tone).toBe('bad');
    expect(below.callouts[0].id).toBe('floor'); // a red callout leads the list
  });

  it('if assigned is strike width less net debit, and turns red when it is a loss', () => {
    const loss = card({}, { strike: 300, credit: 1 });
    expect(tile(loss.candidateTiles, 'if-assigned')).toMatchObject({ value: '-$6,255', tone: 'bad' });
  });
});

describe('credit versus the LEAPS extrinsic per month', () => {
  // extrinsic = 120.45 - (350.86 - 250) = 19.59; per month over 270 days = 2.1767
  it.each([[2.18, 'good'], [2.17, 'watch']])('credit %s is a %s callout', (credit, tone) => {
    expect(callout(card({}, { credit }), 'extrinsic-carry')!.tone).toBe(tone);
  });

  it('is left out when there is no extrinsic value or no stock price', () => {
    expect(callout(card({ markPerShare: 100.86 }), 'extrinsic-carry')).toBeUndefined();
    expect(callout(card({ stockPrice: null }), 'extrinsic-carry')).toBeUndefined();
  });
});

describe('DTE review point', () => {
  it.each([[180, false], [179, true]])('%s days left: review callout %s', (dte, shown) => {
    const c = card({ dte }, null);
    expect(Boolean(callout(c, 'dte'))).toBe(shown);
    expect(tile(c.longTiles, 'dte').tone).toBe(shown ? 'watch' : 'neutral');
  });
});

describe('gaps and shapes', () => {
  it('a loss on the position is amber, not a breach', () => {
    const c = card({ markPerShare: 100 }, null);
    expect(tile(c.longTiles, 'value').parts[0]).toEqual({ text: '-$1,355 · -11.9% vs paid', tone: 'watch' });
  });

  it('missing entry cost gives dashes and says so, without inventing a breakeven', () => {
    const c = card({ entryDebitPerShare: null });
    expect(tile(c.longTiles, 'breakeven').value).toBe('—');
    expect(tile(c.longTiles, 'value')).toMatchObject({ value: '$12,045', parts: [{ text: 'entry cost unavailable', tone: 'neutral' }] });
    expect(tile(c.candidateTiles, 'if-assigned').value).toBe('—');
    expect(tile(c.candidateTiles, 'short-strike')).toMatchObject({ tone: 'neutral' });
    expect(callout(c, 'floor')).toBeUndefined();
    expect(callout(c, 'entry')!.tone).toBe('watch');
  });

  it('missing stock price keeps the breakeven and says the comparison is unavailable', () => {
    expect(tile(card({ stockPrice: null }).longTiles, 'breakeven')).toMatchObject({ value: '$363.55', parts: [{ text: 'stock price unavailable', tone: 'neutral' }] });
  });

  it('no candidate: no income tiles and no candidate callouts', () => {
    const c = card({}, null);
    expect(c.candidateTiles).toEqual([]);
    expect(c.callouts).toEqual([]);
  });

  it('scales with the number of contracts', () => {
    const c = card({ quantity: 2 });
    expect(tile(c.longTiles, 'value').value).toBe('$24,090');
    expect(tile(c.candidateTiles, 'credit').value).toBe('$1,280');
    expect(tile(c.candidateTiles, 'if-assigned').value).toBe('+$3,570');
  });

  it('never mutates its input', () => {
    const l = longCall(); const cand = candidate();
    const before = JSON.stringify([l, cand]);
    buildIncomeCard({ longCall: l, candidate: cand });
    expect(JSON.stringify([l, cand])).toBe(before);
  });
});

describe('real event callouts (LEAPS-EVENTS-0001)', () => {
  it('replace the standing "not checked yet" note when supplied, including an empty list', () => {
    const events = [{ id: 'events', tone: 'good' as const, text: 'No earnings or ex-dividend date before 2026-10-16.' }];
    const c = buildIncomeCard({ longCall: longCall(), candidate: candidate(), events });
    expect(c.callouts.filter(x => x.id === 'events')).toEqual(events);
    expect(buildIncomeCard({ longCall: longCall(), candidate: candidate(), events: [] }).callouts.some(x => x.id === 'events')).toBe(false);
  });

  it('a red event callout leads the list', () => {
    const c = buildIncomeCard({ longCall: longCall(), candidate: candidate(), events: [{ id: 'earnings', tone: 'bad', text: 'Earnings on 2026-10-01 fall before this call expires.' }] });
    expect(c.callouts[0].id).toBe('earnings');
  });

  it('without a candidate there is nothing to check, so no event callout', () => {
    expect(buildIncomeCard({ longCall: longCall(), candidate: null, events: [{ id: 'events', tone: 'good', text: 'x' }] }).callouts).toEqual([]);
  });
});

describe('income rules (LEAPS-MANDATE-0001)', () => {
  const mandate: LeapsMandate = { version: 'LEAPS-PI-1.1', thesis: '', invalidation: '', thesisTargetHigh: 390, invalidationPrice: null, posture: 'balanced', incomeCapStrike: null, minimumCycleCredit: null, allowKnownEarningsCycle: false };
  const gatesFor = (m: LeapsMandate | null, cand: { strike: number; credit: number } | null = { strike: 375, credit: 6.4 }) =>
    applyMandateGates({ mandate: m, longStrike: 250, entryDebitPerShare: 113.55, stockPrice: 350.86, candidate: cand, earningsInWindow: null });

  it('with a target the Upside kept tile replaces Delta kept, and the gate callouts replace the built-in floor callout', () => {
    const c = buildIncomeCard({ longCall: longCall(), candidate: candidate(), gates: gatesFor(mandate) });
    expect(c.candidateTiles.map(t => t.id)).toEqual(['credit', 'short-strike', 'if-assigned', 'upside-kept']);
    expect(tile(c.candidateTiles, 'upside-kept')).toMatchObject({ value: '62%', tone: 'good' });
    expect(tile(c.candidateTiles, 'upside-kept').parts[0].text).toBe('meets your 55% · to your target');
    expect(c.callouts.some(x => x.id === 'floor')).toBe(false);
    expect(c.callouts.map(x => x.id)).toEqual(expect.arrayContaining(['gate-income-floor', 'gate-upside-participation']));
  });

  it('a failing participation shows the tile in red', () => {
    const c = buildIncomeCard({ longCall: longCall(), candidate: candidate({ strike: 364 }), gates: gatesFor({ ...mandate, posture: 'upside-first' }, { strike: 364, credit: 6.4 }) });
    expect(tile(c.candidateTiles, 'upside-kept')).toMatchObject({ tone: 'bad' });
    expect(c.callouts.some(x => x.id === 'gate-upside-participation' && x.tone === 'bad')).toBe(true);
  });

  it('without a target the Delta kept tile stays', () => {
    const c = buildIncomeCard({ longCall: longCall(), candidate: candidate(), gates: gatesFor({ ...mandate, thesisTargetHigh: null }) });
    expect(c.candidateTiles.map(t => t.id)).toEqual(['credit', 'short-strike', 'if-assigned', 'delta-kept']);
  });

  it('a thesis-invalidated callout shows even when there is no candidate', () => {
    const c = buildIncomeCard({ longCall: longCall(), candidate: null, gates: gatesFor({ ...mandate, invalidationPrice: 351 }, null) });
    expect(c.callouts).toEqual([expect.objectContaining({ id: 'gate-invalidated', tone: 'bad' })]);
  });

  it('without gates the card behaves exactly as before', () => {
    expect(buildIncomeCard({ longCall: longCall(), candidate: candidate() }).callouts.some(x => x.id === 'floor')).toBe(true);
  });
});
