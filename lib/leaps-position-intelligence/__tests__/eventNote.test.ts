// lib/leaps-position-intelligence/__tests__/eventNote.test.ts
//
// LEAPS-EVENTS-0001 -- event callouts follow the existing event policy (lib/scans/eventRisk.ts): earnings on or before a not-yet-sold
// call's expiration is a blocker (red); an ex-dividend date before expiration is red only when the call is near or in the money.

import { describe, expect, it } from 'vitest';
import { buildEventCallouts, isNearItm, type EventCheckInput } from '../eventNote';

const TODAY = '2026-09-21';
const input = (over: Partial<EventCheckInput> = {}): EventCheckInput => ({
  status: 'ok', calendar: { earningsDate: null, exDividendDate: null }, shortExpiration: '2026-10-16', mode: 'candidate', nearItm: false, today: TODAY, ...over,
});
const ids = (i: EventCheckInput) => buildEventCallouts(i).map(c => [c.id, c.tone]);

describe('data that could not be verified is never "clear"', () => {
  it('loading shows a neutral checking note', () => {
    expect(buildEventCallouts(input({ status: 'loading', calendar: null }))).toEqual([{ id: 'events', tone: 'neutral', text: 'Checking earnings and ex-dividend dates…' }]);
  });
  it.each([['unavailable status', { status: 'unavailable' as const }], ['no calendar', { calendar: null }]])('%s is a watch note', (_name, over) => {
    expect(buildEventCallouts(input(over))).toEqual([{ id: 'events', tone: 'watch', text: 'Earnings and ex-dividend dates could not be verified: check them before relying on this call.' }]);
  });
});

describe('earnings', () => {
  it.each([['2026-10-16', true], ['2026-10-17', false], ['2026-09-21', true], ['2026-09-20', false]])('earnings %s within [today, expiry]: %s', (earningsDate, hit) => {
    const out = buildEventCallouts(input({ calendar: { earningsDate, exDividendDate: null } }));
    expect(out.some(c => c.id === 'earnings')).toBe(hit);
  });

  it('is red for a call not yet sold and amber for one already open', () => {
    const calendar = { earningsDate: '2026-10-01', exDividendDate: null };
    expect(ids(input({ calendar, mode: 'candidate' }))).toEqual([['earnings', 'bad']]);
    expect(ids(input({ calendar, mode: 'open-call' }))).toEqual([['earnings', 'watch']]);
    expect(buildEventCallouts(input({ calendar }))[0].text).toBe('Earnings on 2026-10-01 fall before this call expires.');
  });
});

describe('ex-dividend', () => {
  const calendar = { earningsDate: null, exDividendDate: '2026-10-08' };
  it('is amber when the call is comfortably out of the money', () => {
    expect(ids(input({ calendar, nearItm: false }))).toEqual([['ex-dividend', 'watch']]);
    expect(buildEventCallouts(input({ calendar }))[0].text).toBe('Ex-dividend date 2026-10-08 falls before this call expires.');
  });
  it('is red when the call is near or in the money (assignment risk)', () => {
    expect(ids(input({ calendar, nearItm: true }))).toEqual([['ex-dividend', 'bad']]);
    expect(buildEventCallouts(input({ calendar, nearItm: true }))[0].text).toContain('early assignment is possible');
  });
  it('a date after the call expires is ignored', () => {
    expect(ids(input({ calendar: { earningsDate: null, exDividendDate: '2026-10-17' } }))).toEqual([['events', 'good']]);
  });
});

describe('the clear case and combinations', () => {
  it('no events in the window is a green note that names the expiration', () => {
    expect(buildEventCallouts(input())).toEqual([{ id: 'events', tone: 'good', text: 'No earnings or ex-dividend date before 2026-10-16.' }]);
  });
  it('both events give both callouts, and no green note', () => {
    expect(ids(input({ calendar: { earningsDate: '2026-10-01', exDividendDate: '2026-10-08' }, nearItm: true }))).toEqual([['earnings', 'bad'], ['ex-dividend', 'bad']]);
  });
  it('malformed dates are ignored rather than trusted', () => {
    expect(ids(input({ calendar: { earningsDate: 'soon', exDividendDate: '10/08/2026' } }))).toEqual([['events', 'good']]);
  });
});

describe('isNearItm (same 3% band as the cycle card)', () => {
  it.each([[375, 350, false], [360, 350, true], [353, 350, true], [350, 350, true], [340, 350, true], [360.5, 350, false]])('strike %s vs stock %s -> %s', (strike, stock, near) => {
    expect(isNearItm(strike, stock)).toBe(near);
  });
  it('unknown stock price is not near', () => {
    expect(isNearItm(375, null)).toBe(false);
    expect(isNearItm(375, undefined)).toBe(false);
    expect(isNearItm(375, 0)).toBe(false);
  });
});
