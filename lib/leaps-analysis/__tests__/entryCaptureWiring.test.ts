// lib/leaps-analysis/__tests__/entryCaptureWiring.test.ts
//
// LEAPS-ENTRY-0001 -- the entry record is captured only after the broker has ACCEPTED a submitted order, never for a dry run or a refused
// order, and a capture failure can never change the order's result. (The recorder itself is tested in leaps-position-intelligence.)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ioredis', () => ({
  default: class FakeRedis {
    hgetall = vi.fn(async () => ({ refresh_token: 'r', client_secret: 's' }));
    hset = vi.fn(async () => 1);
    disconnect = vi.fn();
  },
}));
vi.mock('@/lib/crypto', () => ({ decrypt: (value: string) => value, encrypt: (value: string) => value }));

const events: string[] = [];
const recordMock = vi.fn(async (..._args: unknown[]): Promise<string> => { events.push('record'); return 'saved'; });
vi.mock('@/lib/leaps-position-intelligence/entryCapture', () => ({ recordEntryBestEffort: (...args: unknown[]) => recordMock(...args) }));

let pmccAction = 'NEW_PMCC_REVIEW_ALLOWED';
// PMCC-HELD-BREAKEVEN-0001: the held order path also checks pair.qualified directly, so the mocked (qualified) pair carries it.
vi.mock('@/lib/scans/pmccPairing', () => ({ pairPmccCandidates: () => ({ qualifiedPairs: [{ id: 'pair', qualified: true }], nearMissPairs: [] }) }));
vi.mock('@/lib/scans/pmccDecision', () => ({ evaluatePmccDecision: () => ({ action: pmccAction, qualification: 'QUALIFIED', readiness: 'READY', gates: [] }) }));

import { submitHeldPmccShortCallOrder, submitLeapsOrder, submitPmccOrder } from '../serverTradeReview';

const LONG_OCC = 'GOOGL 270617C00250000';
const SHORT_OCC = 'GOOGL 261016C00375000';
const NOW = '2026-09-21T15:00:00.000Z'; // 11:00 ET, regular session
const secondsBefore = (seconds: number) => new Date(Date.parse(NOW) - seconds * 1000).toISOString();
const fetchMock = vi.fn();
let quotes: Record<string, Record<string, unknown>>;
let orderResponse: { ok: boolean; body: unknown };

function stubBroker() {
  fetchMock.mockImplementation(async (url: string) => {
    const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });
    if (url.includes('/oauth/token')) return json({ access_token: 'token' });
    if (url.includes('/customers/me/accounts')) return json({ data: { items: [{ account: { 'account-number': 'ACC1' } }] } });
    if (url.includes('/option-chains/')) {
      return json({ data: { items: [{ expirations: [
        { 'expiration-date': '2027-06-17', strikes: [{ 'strike-price': '250', call: LONG_OCC }] },
        { 'expiration-date': '2026-10-16', strikes: [{ 'strike-price': '375', call: SHORT_OCC }] },
      ] }] } });
    }
    if (url.includes('equity-option=')) {
      const symbol = decodeURIComponent(url.split('equity-option=')[1]);
      return json({ data: { items: [{ symbol, ...quotes[symbol], 'updated-at': secondsBefore(10) }] } });
    }
    if (url.includes('by-type?equity=')) return json({ data: { items: [{ last: 350.858, 'updated-at': secondsBefore(5) }] } });
    if (url.includes('/positions')) {
      return json({ data: { items: [{ symbol: LONG_OCC, 'underlying-symbol': 'GOOGL', 'quantity-direction': 'Long', 'instrument-type': 'Equity Option', quantity: '1', 'average-open-price': '113.55', 'expires-at': '2027-06-17T20:00:00Z' }] } });
    }
    if (url.includes('/orders')) { events.push('broker-order'); return json(orderResponse.body, orderResponse.ok, orderResponse.ok ? 200 : 422); }
    throw new Error(`unexpected url ${url}`);
  });
}

beforeEach(() => {
  events.length = 0; recordMock.mockClear(); recordMock.mockImplementation(async () => { events.push('record'); return 'saved'; });
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('REDIS_URL', 'redis://test'); vi.stubEnv('TASTYTRADE_CLIENT_ID', 'client-id');
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
  pmccAction = 'NEW_PMCC_REVIEW_ALLOWED';
  quotes = {
    [LONG_OCC]: { bid: 112.2, ask: 114.9, delta: 0.84569266, 'open-interest': 1296, volatility: 0.364 },
    [SHORT_OCC]: { bid: 6.4, ask: 6.7, delta: 0.28, 'open-interest': 500, volatility: 0.34 },
  };
  orderResponse = { ok: true, body: { data: { order: { id: 555, status: 'Received' } } } };
  stubBroker();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const leapsInput = (mode: 'dry-run' | 'submit') => ({ accountLocator: null, underlyingSymbol: 'GOOGL', occSymbol: LONG_OCC, quantity: 2, limitPrice: 113.55, mode });
const pmccInput = (mode: 'dry-run' | 'submit') => ({ accountLocator: null, underlyingSymbol: 'GOOGL', longOccSymbol: LONG_OCC, shortOccSymbol: SHORT_OCC, quantity: 1, limitPrice: 107.15, mode });

describe('LEAPS order', () => {
  it('records the market state once, after the broker accepted the submit, and returns the broker order unchanged', async () => {
    const result = await submitLeapsOrder('user-a', leapsInput('submit'));

    expect(result.order).toEqual({ order: { id: 555, status: 'Received' } });
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['broker-order', 'record']); // never before the broker answered
    expect(recordMock.mock.calls[0][0]).toMatchObject({
      kind: 'leaps-entry', userId: 'user-a', accountNumber: 'ACC1', underlyingSymbol: 'GOOGL', longOccSymbol: LONG_OCC, shortOccSymbol: null,
      quantity: 2, limitPrice: 113.55, priceEffect: 'Debit', short: null, order: { order: { id: 555, status: 'Received' } },
      long: { occSymbol: LONG_OCC, strike: 250, bid: 112.2, ask: 114.9, spot: 350.858, delta: 0.84569266 },
    });
  });

  it('records nothing for a dry run', async () => {
    const result = await submitLeapsOrder('user-a', leapsInput('dry-run'));
    expect(result.order).not.toBeNull();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('records nothing when the contract does not qualify (no order is sent)', async () => {
    quotes[LONG_OCC] = { ...quotes[LONG_OCC], delta: 0.6 };
    const result = await submitLeapsOrder('user-a', leapsInput('submit'));
    expect(result.order).toBeNull();
    expect(events).toEqual([]);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('records nothing when the broker refuses the order, and the refusal still surfaces', async () => {
    orderResponse = { ok: false, body: { error: { message: 'Insufficient buying power' } } };
    await expect(submitLeapsOrder('user-a', leapsInput('submit'))).rejects.toThrow('Insufficient buying power');
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('a capture that rejects or throws cannot change the order result', async () => {
    recordMock.mockImplementation(async () => { events.push('record'); throw new Error('redis is down'); });
    const result = await submitLeapsOrder('user-a', leapsInput('submit'));
    expect(result.order).toEqual({ order: { id: 555, status: 'Received' } });
    expect(result.review.qualification.status).toBe('CONTRACT_QUALIFIED');
    expect(events).toEqual(['broker-order', 'record']);
  });
});

describe('PMCC pair order', () => {
  it('records a pmcc-entry with both legs after the broker accepted the submit', async () => {
    const result = await submitPmccOrder('user-a', pmccInput('submit'));

    expect(result.order).toEqual({ order: { id: 555, status: 'Received' } });
    expect(events).toEqual(['broker-order', 'record']);
    expect(recordMock.mock.calls[0][0]).toMatchObject({
      kind: 'pmcc-entry', userId: 'user-a', accountNumber: 'ACC1', longOccSymbol: LONG_OCC, shortOccSymbol: SHORT_OCC, quantity: 1, limitPrice: 107.15, priceEffect: 'Debit',
      long: { occSymbol: LONG_OCC, bid: 112.2 }, short: { occSymbol: SHORT_OCC, bid: 6.4, ask: 6.7 },
    });
  });

  it('records nothing for a dry run, or when the decision blocks the order', async () => {
    await submitPmccOrder('user-a', pmccInput('dry-run'));
    pmccAction = 'BLOCKED';
    const blocked = await submitPmccOrder('user-a', pmccInput('submit'));
    expect(blocked.order).toBeNull();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('a capture failure cannot change the order result', async () => {
    recordMock.mockImplementation(async () => { throw new Error('redis is down'); });
    expect((await submitPmccOrder('user-a', pmccInput('submit'))).order).toEqual({ order: { id: 555, status: 'Received' } });
  });
});

describe('short call sold against a held LEAPS', () => {
  it('records a short-call-sold (credit) with the held LEAPS state as context, after the broker accepted', async () => {
    pmccAction = 'HELD_PMCC_REVIEW_ONLY';
    const result = await submitHeldPmccShortCallOrder('user-a', { ...pmccInput('submit'), limitPrice: 6.4 });

    expect(result.order).toEqual({ order: { id: 555, status: 'Received' } });
    expect(events).toEqual(['broker-order', 'record']);
    expect(recordMock.mock.calls[0][0]).toMatchObject({
      kind: 'short-call-sold', accountNumber: 'ACC1', longOccSymbol: LONG_OCC, shortOccSymbol: SHORT_OCC, limitPrice: 6.4, priceEffect: 'Credit',
      long: { occSymbol: LONG_OCC }, short: { occSymbol: SHORT_OCC },
    });
  });

  it('records nothing for a dry run or a blocked decision', async () => {
    pmccAction = 'HELD_PMCC_REVIEW_ONLY';
    await submitHeldPmccShortCallOrder('user-a', { ...pmccInput('dry-run'), limitPrice: 6.4 });
    pmccAction = 'BLOCKED';
    expect((await submitHeldPmccShortCallOrder('user-a', { ...pmccInput('submit'), limitPrice: 6.4 })).order).toBeNull();
    expect(recordMock).not.toHaveBeenCalled();
  });
});
