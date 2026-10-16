// lib/entry-walk/__tests__/bracket.test.ts
//
// ORDER-TICK-0001: the profit target and stop are sent on the exchange's tick. Regression: a 2x stop on a $2.48 credit
// was $4.96 / $5.46, and prices at or above $3.00 must sit on a $0.05 tick ("Price must be in increments of $0.05").

import { describe, it, expect } from 'vitest';
import { bracketForPrice, describeOrderPrices } from '../bracket';
import { isOnTick, type TickTable } from '@/lib/portfolio/tickSize';

// $0.01 below $3.00, $0.05 at or above (penny-pilot roots such as TQQQ and SOXL).
const PENNY: TickTable = [{ threshold: 3, value: 0.01 }, { threshold: null, value: 0.05 }];
// $0.05 below $3.00, $0.10 at or above (non-penny roots).
const NICKEL: TickTable = [{ threshold: 3, value: 0.05 }, { threshold: null, value: 0.10 }];

describe('bracketForPrice without a tick table (unchanged behaviour)', () => {
  it('keeps whole-cent exits', () => {
    expect(bracketForPrice(2.48, 50, 2)).toEqual({ entryCredit: 2.48, profitBuyback: 1.24, stopTrigger: 4.96, stopLimit: 5.46 });
  });
  it('treats an explicit null table the same way', () => {
    expect(bracketForPrice(2.48, 50, 2, null)).toEqual(bracketForPrice(2.48, 50, 2));
  });
});

describe('bracketForPrice with a tick table', () => {
  it('the reported case: a $2.48 credit sends a $4.95 trigger and a $5.50 limit, not $4.96 / $5.46', () => {
    const b = bracketForPrice(2.48, 50, 2, PENNY);
    expect(b).toEqual({ entryCredit: 2.48, profitBuyback: 1.24, stopTrigger: 4.95, stopLimit: 5.5 });
  });

  it('rounds to the wider tick for a non-penny root', () => {
    const b = bracketForPrice(2.48, 50, 2, NICKEL);
    expect(b.stopTrigger).toBe(5);
    expect(b.stopLimit).toBe(5.5);
  });

  it('never changes the entry credit', () => {
    expect(bracketForPrice(2.48, 50, 2, PENNY).entryCredit).toBe(2.48);
  });

  it('a profit target never reaches the entry credit', () => {
    const b = bracketForPrice(0.04, 10, 2, PENNY);
    expect(b.profitBuyback).toBeLessThan(0.04);
    expect(b.profitBuyback).toBeGreaterThan(0);
  });

  it('every exit is on tick and the limit never falls below the trigger, across credits and multiples', () => {
    for (const table of [PENNY, NICKEL]) {
      // From 10 cents up: a credit equal to one tick has no valid target below it (buildCreditEntryOtoco rejects it).
      for (let cents = 10; cents <= 800; cents++) {
        for (const multiple of [1.5, 2, 2.5, 3]) {
          for (const gtcPct of [25, 50, 75]) {
            const entry = cents / 100;
            const b = bracketForPrice(entry, gtcPct, multiple, table);
            expect(isOnTick(b.profitBuyback, table), `buyback ${b.profitBuyback} @ ${entry}`).toBe(true);
            expect(isOnTick(b.stopTrigger, table), `trigger ${b.stopTrigger} @ ${entry}`).toBe(true);
            expect(isOnTick(b.stopLimit, table), `limit ${b.stopLimit} @ ${entry}`).toBe(true);
            expect(b.stopLimit).toBeGreaterThanOrEqual(b.stopTrigger);
            expect(b.profitBuyback).toBeLessThan(entry);
          }
        }
      }
    }
  });
});

describe('describeOrderPrices', () => {
  const payload = {
    'trigger-order': { price: '2.48' },
    orders: [{ price: '1.24' }, { 'stop-trigger': '4.95', price: '5.50' }],
  };
  it('names every sent price and the tick table', () => {
    expect(describeOrderPrices(payload, PENNY)).toBe(
      'Sent: entry $2.48, profit target $1.24, stop trigger $4.95, stop limit $5.50. Tick table: $0.01 below $3, then $0.05.',
    );
  });
  it('says so when no tick table was loaded', () => {
    expect(describeOrderPrices(payload, null)).toContain('Tick table: not loaded (whole cents assumed).');
  });
  it('tolerates a malformed payload', () => {
    expect(describeOrderPrices(null, null)).toContain('entry n/a');
  });
});
