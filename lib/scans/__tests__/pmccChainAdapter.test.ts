import { describe, expect, it } from 'vitest';
import { adaptPmccChain } from '../pmccChainAdapter';

describe('adaptPmccChain', () => {
  it('preserves overlapping windows and quote metadata', () => {
    const expiration = '2026-09-18';
    const raw = {
      shortExpirations: [expiration], longExpirations: [expiration],
      chains: { [expiration]: [{
        strikePrice: 100, expirationDate: expiration, optionType: 'C',
        delta: '0.80', openInterest: '123', bid: '9', ask: '10',
        occSymbol: 'GS260918C00100000', quoteTimestamp: '2026-08-14T20:00:00Z', delayed: false,
      }] },
    };
    const result = adaptPmccChain('gs', raw);
    expect(result.longLegs).toHaveLength(1);
    expect(result.shortLegs).toHaveLength(1);
    expect(result.longLegs[0]).toMatchObject({
      underlyingSymbol: 'GS', strike: 100, delta: 0.8,
      openInterest: 123, bid: 9, ask: 10, delayed: false,
    });
    expect(result.shortLegs[0]).toEqual(result.longLegs[0]);
  });
});
