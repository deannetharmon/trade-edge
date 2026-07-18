// lib/paper-trading/__tests__/validation.test.ts

import { describe, expect, it } from 'vitest';
import { validateTicket, validateContractMultiplier } from '../validation';
import { PaperTradingError } from '../types';
import type { PaperLeg } from '../types';

const EXP = '2026-08-21';

function leg(overrides: Partial<PaperLeg>): PaperLeg {
  return { legId: 'leg', optionType: 'put', strike: 100, expiration: EXP, openAction: 'sell_to_open', ...overrides };
}

describe('validateTicket', () => {
  it('accepts a valid CSP', () => {
    expect(() =>
      validateTicket({
        symbol: 'SPY',
        strategy: 'CSP',
        expiration: EXP,
        quantity: 1,
        legs: [leg({ legId: 'p1', optionType: 'put', strike: 500, openAction: 'sell_to_open' })],
      }),
    ).not.toThrow();
  });

  it('accepts a valid BPS', () => {
    expect(() =>
      validateTicket({
        symbol: 'SPY',
        strategy: 'BPS',
        expiration: EXP,
        quantity: 1,
        legs: [
          leg({ legId: 'short', optionType: 'put', strike: 500, openAction: 'sell_to_open' }),
          leg({ legId: 'long', optionType: 'put', strike: 490, openAction: 'buy_to_open' }),
        ],
      }),
    ).not.toThrow();
  });

  it('accepts a valid BCS', () => {
    expect(() =>
      validateTicket({
        symbol: 'SPY',
        strategy: 'BCS',
        expiration: EXP,
        quantity: 1,
        legs: [
          leg({ legId: 'short', optionType: 'call', strike: 520, openAction: 'sell_to_open' }),
          leg({ legId: 'long', optionType: 'call', strike: 530, openAction: 'buy_to_open' }),
        ],
      }),
    ).not.toThrow();
  });

  it('accepts a valid IC', () => {
    expect(() =>
      validateTicket({
        symbol: 'SPY',
        strategy: 'IC',
        expiration: EXP,
        quantity: 1,
        legs: [
          leg({ legId: 'short-put', optionType: 'put', strike: 490, openAction: 'sell_to_open' }),
          leg({ legId: 'long-put', optionType: 'put', strike: 480, openAction: 'buy_to_open' }),
          leg({ legId: 'short-call', optionType: 'call', strike: 520, openAction: 'sell_to_open' }),
          leg({ legId: 'long-call', optionType: 'call', strike: 530, openAction: 'buy_to_open' }),
        ],
      }),
    ).not.toThrow();
  });

  it('rejects malformed legs (bad optionType)', () => {
    expect(() =>
      validateTicket({
        symbol: 'SPY',
        strategy: 'CSP',
        expiration: EXP,
        quantity: 1,
        legs: [{ ...leg({}), optionType: 'bogus' as any }],
      }),
    ).toThrow(PaperTradingError);
  });

  it('rejects mixed expiration across legs', () => {
    expect(() =>
      validateTicket({
        symbol: 'SPY',
        strategy: 'BPS',
        expiration: EXP,
        quantity: 1,
        legs: [
          leg({ legId: 'short', strike: 500, openAction: 'sell_to_open', expiration: EXP }),
          leg({ legId: 'long', strike: 490, openAction: 'buy_to_open', expiration: '2026-09-18' }),
        ],
      }),
    ).toThrow(/expiration/i);
  });

  it('rejects an unsupported strategy', () => {
    expect(() =>
      validateTicket({
        symbol: 'SPY',
        strategy: 'PMCC',
        expiration: EXP,
        quantity: 1,
        legs: [leg({})],
      }),
    ).toThrow(/Unsupported strategy/);
  });

  it('rejects invalid (zero/negative/non-integer) quantity', () => {
    for (const quantity of [0, -1, 1.5]) {
      expect(() =>
        validateTicket({ symbol: 'SPY', strategy: 'CSP', expiration: EXP, quantity, legs: [leg({})] }),
      ).toThrow(/Quantity/);
    }
  });

  it('rejects non-finite strike values', () => {
    expect(() =>
      validateTicket({
        symbol: 'SPY',
        strategy: 'CSP',
        expiration: EXP,
        quantity: 1,
        legs: [leg({ strike: NaN })],
      }),
    ).toThrow(PaperTradingError);
  });

  it('rejects an inverted BPS spread (short strike below long strike)', () => {
    expect(() =>
      validateTicket({
        symbol: 'SPY',
        strategy: 'BPS',
        expiration: EXP,
        quantity: 1,
        legs: [
          leg({ legId: 'short', strike: 480, openAction: 'sell_to_open' }),
          leg({ legId: 'long', strike: 490, openAction: 'buy_to_open' }),
        ],
      }),
    ).toThrow(/short strike/i);
  });

  it('rejects a zero-width spread', () => {
    expect(() =>
      validateTicket({
        symbol: 'SPY',
        strategy: 'BPS',
        expiration: EXP,
        quantity: 1,
        legs: [
          leg({ legId: 'short', strike: 490, openAction: 'sell_to_open' }),
          leg({ legId: 'long', strike: 490, openAction: 'buy_to_open' }),
        ],
      }),
    ).toThrow(/different strikes/i);
  });

  it('rejects an overlapping IC (put spread crosses into call spread)', () => {
    expect(() =>
      validateTicket({
        symbol: 'SPY',
        strategy: 'IC',
        expiration: EXP,
        quantity: 1,
        legs: [
          leg({ legId: 'short-put', optionType: 'put', strike: 510, openAction: 'sell_to_open' }),
          leg({ legId: 'long-put', optionType: 'put', strike: 480, openAction: 'buy_to_open' }),
          leg({ legId: 'short-call', optionType: 'call', strike: 505, openAction: 'sell_to_open' }),
          leg({ legId: 'long-call', optionType: 'call', strike: 530, openAction: 'buy_to_open' }),
        ],
      }),
    ).toThrow(/overlap/i);
  });

  it('rejects an unparsable expiration', () => {
    expect(() =>
      validateTicket({ symbol: 'SPY', strategy: 'CSP', expiration: 'not-a-date', quantity: 1, legs: [leg({ expiration: 'not-a-date' })] }),
    ).toThrow(PaperTradingError);
  });
});

describe('validateContractMultiplier', () => {
  it('accepts 100', () => {
    expect(() => validateContractMultiplier(100)).not.toThrow();
  });
  it('rejects anything else', () => {
    expect(() => validateContractMultiplier(1)).toThrow(PaperTradingError);
    expect(() => validateContractMultiplier(NaN)).toThrow(PaperTradingError);
  });
});
