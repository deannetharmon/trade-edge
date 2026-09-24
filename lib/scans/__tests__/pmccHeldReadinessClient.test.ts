// lib/scans/__tests__/pmccHeldReadinessClient.test.ts
//
// PMCC-HELD-BREAKEVEN-0001 W3: the held readiness client (evaluateHeldPmccLiveReadiness) goes through
// runPmccSymbolProduction, so it inherits the production wiring. Real pairing and decision; only the
// broker chain and quote acquisition are faked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../tastytrade-client', () => ({
  getAccessToken: vi.fn(async () => 'token'),
  getQuote: vi.fn(async () => 1037.55),
}));
vi.mock('../pmccChainClient', () => ({
  getPmccChain: vi.fn(async () => {
    const stamp = new Date(Date.parse('2026-08-14T15:00:00.000Z') - 30_000).toISOString();
    const occ = (expiration: string, strike: number) => `GS${expiration.slice(2).replace(/-/g, '')}C${String(strike * 1000).padStart(8, '0')}`;
    const leg = (expiration: string, strike: number, delta: number, bid: number, ask: number) => ({
      optionType: 'C', strikePrice: strike, delta, openInterest: 500, bid, ask, occSymbol: occ(expiration, strike), quoteTimestamp: stamp, delayed: false,
    });
    return {
      shortExpirations: ['2026-09-18'], longExpirations: ['2027-06-18'], isEtfOrIndex: false, classification: 'stock' as const,
      chains: { '2027-06-18': [leg('2027-06-18', 720, 0.8, 320, 322)], '2026-09-18': [leg('2026-09-18', 1070, 0.25, 8, 8.2)] },
    };
  }),
}));

import { evaluateHeldPmccLiveReadiness } from '../pmccHeldReadinessClient';
import type { HeldPmccLongCandidate } from '../pmccHeldLeaps';

const OCC = 'GS270618C00720000';
const held = (overrides: Partial<HeldPmccLongCandidate> = {}): HeldPmccLongCandidate => ({
  accountNumber: '5WT00001', positionKey: 'held-gs', underlyingSymbol: 'GS', occSymbol: OCC,
  expiration: '2027-06-18', dte: 308, strike: 720, quantity: 1, avgOpenPrice: 345, ...overrides,
});

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-08-14T15:00:00.000Z')); });
afterEach(() => { vi.useRealTimers(); });

// Short 1070 bid 8 => Ks + bid = 1078. Floor = 720 + avgOpenPrice.
describe('evaluateHeldPmccLiveReadiness: held floor (W3)', () => {
  it('control: a single-lot LEAP with a valid cost whose short clears the floor reviews an income call', async () => {
    const result = await evaluateHeldPmccLiveReadiness(held());
    expect(result.status).toBe('review-income-call');
  });

  it('W3: a quantity 2 LEAP is not review-income-call, and the reason surfaces the multi-lot detail, not the generic no-candidate copy', async () => {
    const result = await evaluateHeldPmccLiveReadiness(held({ quantity: 2 }));
    expect(result.status).not.toBe('review-income-call');
    // monitorReason is not asserted: the client's /QUOTE|BID_ASK|MARKET/ gate-code regex also matches the
    // passing QUOTES_READY gate, so any blocked held pair reads 'quote-quality' today (pre-existing, logged
    // as a finding for 0001B; the reason string below is what the trader sees).
    expect(result).toMatchObject({ status: 'monitor', reason: 'multi-lot LEAP: cost averaging unverified' });
    expect(result.reason).not.toContain('No qualifying short-call candidate');
  });

  it('a LEAP with no usable cost is not review-income-call and says "cost basis unavailable"', async () => {
    const result = await evaluateHeldPmccLiveReadiness(held({ avgOpenPrice: null }));
    expect(result.status).not.toBe('review-income-call');
    expect(result.reason).toBe('cost basis unavailable');
  });

  it('a floor-failed short (cost 358 makes 1078 = 1078) is not review-income-call', async () => {
    const result = await evaluateHeldPmccLiveReadiness(held({ avgOpenPrice: 358 }));
    expect(result.status).not.toBe('review-income-call');
    expect(result.reason).toBe('Short strike plus bid must exceed held LEAP strike plus cost basis');
  });
});
