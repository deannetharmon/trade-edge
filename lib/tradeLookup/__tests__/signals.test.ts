// lib/tradeLookup/__tests__/signals.test.ts

import { describe, expect, it } from 'vitest';
import { buildSignals, type SignalInput } from '../signals';

const fall: number[] = [];
for (let i = 0; i < 60; i++) fall.push(100 - i * 0.5);
const turningUp = fall.concat([70.5, 71.2, 72.1, 73.3, 74.6]);
const rising: number[] = [];
for (let i = 0; i < 60; i++) rising.push(50 + i);

const EXP = '2026-11-06'; // a Friday
const base = (over: Partial<SignalInput> = {}): SignalInput => ({
  closes: turningUp, earningsDate: null, classification: 'stock', expirations: [EXP], asOf: '2026-10-15T16:00:00Z', ...over,
});

describe('buildSignals: RSI', () => {
  it('uses the shared RSI turn classifier and its tones', () => {
    const up = buildSignals(base()).rsi!;
    expect(up.state).toBe('TURNING_UP');
    expect(up.label).toBe('Turning up');
    expect(up.tone).toBe('up');
    expect(up.value).toBe(44);
    const hot = buildSignals(base({ closes: rising })).rsi!;
    expect(hot.state).toBe('OVERBOUGHT_NO_TURN');
    expect(hot.tone).toBe('neutral');
  });
  it('is null with too few bars or no bars', () => {
    expect(buildSignals(base({ closes: [1, 2, 3] })).rsi).toBeNull();
    expect(buildSignals(base({ closes: null })).rsi).toBeNull();
  });
  it('is the same for ETFs and indices (RSI is not a single-stock signal)', () => {
    expect(buildSignals(base({ classification: 'etf' })).rsi).not.toBeNull();
  });
});

describe('buildSignals: earnings', () => {
  const at = (earningsDate: string | null, over: Partial<SignalInput> = {}) => buildSignals(base({ earningsDate, ...over })).earnings;

  it('highlights earnings on or before the expiration', () => {
    const e = at('2026-10-30');
    expect(e.applies).toBe(true);
    expect(e.daysOut).toBe(15);
    expect(e.forExpiration[EXP].highlight).toBe(true);
    expect(e.forExpiration[EXP].text).toContain('on or before this expiration');
  });
  it('highlights earnings just after expiration with the shared tag', () => {
    const e = at('2026-11-09'); // Monday after
    expect(e.forExpiration[EXP]).toEqual({ highlight: true, text: 'Earnings 1 bd after expiry (2026-11-09)' });
  });
  it('is silent when earnings are well after expiration or already past', () => {
    expect(at('2026-12-15').forExpiration[EXP].highlight).toBe(false);
    const past = at('2026-10-01');
    expect(past.forExpiration[EXP].highlight).toBe(false);
    expect(past.daysOut).toBe(-14);
  });
  it('is silent without a date (EARNINGS-NO-DATE-0001)', () => {
    const e = at(null);
    expect(e.applies).toBe(true);
    expect(e.date).toBeNull();
    expect(e.forExpiration[EXP]).toBeUndefined();
  });
  it('never applies to ETFs, indices or an unknown classification', () => {
    for (const c of ['etf', 'index', null] as const) {
      const e = at('2026-10-30', { classification: c });
      expect(e.applies).toBe(false);
      expect(e.date).toBeNull();
      expect(Object.keys(e.forExpiration)).toHaveLength(0);
    }
  });
  it('classifies each expiration on its own (posted and next)', () => {
    const e = at('2026-11-10', { expirations: ['2026-11-06', '2026-11-13'] });
    expect(e.forExpiration['2026-11-06'].highlight).toBe(true); // 2 bd after
    expect(e.forExpiration['2026-11-13'].highlight).toBe(true); // on or before
  });
  it('ignores an unparseable date', () => {
    expect(at('soon').date).toBeNull();
  });
});
