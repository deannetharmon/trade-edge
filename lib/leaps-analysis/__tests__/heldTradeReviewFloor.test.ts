// lib/leaps-analysis/__tests__/heldTradeReviewFloor.test.ts
//
// PMCC-HELD-BREAKEVEN-0001 W2: the server held trade review (submitHeldPmccShortCallOrder), the order path.
// Real pairing and real decision; only the broker (fetch), Redis, crypto and the entry recorder are faked.
// A floor-failed or cost-unavailable held pair may still reach `qualified[0] ?? nearMiss[0]`, but it must
// never make the review ready and never build an order body.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ioredis', () => ({
  default: class FakeRedis {
    hgetall = vi.fn(async () => ({ refresh_token: 'r', client_secret: 's' }));
    hset = vi.fn(async () => 1);
    disconnect = vi.fn();
  },
}));
vi.mock('@/lib/crypto', () => ({ decrypt: (value: string) => value, encrypt: (value: string) => value }));
vi.mock('@/lib/leaps-position-intelligence/entryCapture', () => ({ recordEntryBestEffort: vi.fn(async () => 'saved') }));

import { submitHeldPmccShortCallOrder } from '../serverTradeReview';

const LONG_OCC = 'GOOGL 270617C00250000';
const SHORT_OCC = 'GOOGL 261016C00375000';
const NOW = '2026-09-21T15:00:00.000Z'; // 11:00 ET, regular session
const secondsBefore = (seconds: number) => new Date(Date.parse(NOW) - seconds * 1000).toISOString();
const fetchMock = vi.fn();
let heldItem: Record<string, unknown> | null;
let quotes: Record<string, Record<string, unknown>>;

const positionItem = (overrides: Record<string, unknown> = {}) => ({
  symbol: LONG_OCC, 'underlying-symbol': 'GOOGL', 'quantity-direction': 'Long', 'instrument-type': 'Equity Option',
  quantity: '1', 'average-open-price': '113.55', 'expires-at': '2027-06-17T20:00:00Z', ...overrides,
});

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
    if (url.includes('/positions')) return json({ data: { items: heldItem ? [heldItem] : [] } });
    if (url.includes('/orders')) return json({ data: { order: { id: 555, status: 'Received' } } });
    throw new Error(`unexpected url ${url}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('REDIS_URL', 'redis://test'); vi.stubEnv('TASTYTRADE_CLIENT_ID', 'client-id');
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
  // Short 375 bid 6.40: Ks + bid = 381.40. Held long 250: the floor clears while avgOpen < 131.40.
  quotes = {
    [LONG_OCC]: { bid: 112.2, ask: 114.9, delta: 0.84569266, 'open-interest': 1296, volatility: 0.364 },
    [SHORT_OCC]: { bid: 6.4, ask: 6.5, delta: 0.28, 'open-interest': 500, volatility: 0.34 },
  };
  heldItem = positionItem();
  stubBroker();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const sell = (quantity = 1) => ({ accountLocator: null, underlyingSymbol: 'GOOGL', longOccSymbol: LONG_OCC, shortOccSymbol: SHORT_OCC, quantity, limitPrice: 6.4, mode: 'dry-run' as const });
const orderCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/orders'));
const structureGate = (decision: { gates: Array<{ code: string; explanation: string }> }, code: string) => decision.gates.find(gate => gate.code === `STRUCTURE_${code}`);

describe('submitHeldPmccShortCallOrder: held floor on the order path (W2)', () => {
  it('control: a single-lot held LEAP with a valid cost whose short clears the floor is ready and builds the order (A34: sell quantity is unrelated)', async () => {
    const result = await submitHeldPmccShortCallOrder('user-a', sell(1));
    expect(result.decision.action).toBe('HELD_PMCC_REVIEW_ONLY');
    expect(result.order).not.toBeNull();
    expect(orderCalls()).toHaveLength(1);
    expect(JSON.parse(String(orderCalls()[0][1].body)).legs).toEqual([expect.objectContaining({ symbol: SHORT_OCC, quantity: 1, action: 'Sell to Open' })]);
  });

  it('quantity "2" (with a valid cost "20.85", sell quantity 1): not ready, no order body, multi-lot detail', async () => {
    heldItem = positionItem({ quantity: '2', 'average-open-price': '20.85', 'quantity-direction': 'Long' });
    const result = await submitHeldPmccShortCallOrder('user-a', sell(1));
    expect(result.order).toBeNull();
    expect(result.decision.action).toBe('BLOCKED');
    expect(orderCalls()).toHaveLength(0);
    expect(structureGate(result.decision, 'COST_BASIS_UNAVAILABLE')?.explanation).toBe('multi-lot LEAP: cost averaging unverified');
  });

  it('quantity "1.5" proves strict parsing (parseInt would read 1): not ready, "held quantity invalid"', async () => {
    heldItem = positionItem({ quantity: '1.5' });
    const result = await submitHeldPmccShortCallOrder('user-a', sell(1));
    expect(result.order).toBeNull();
    expect(orderCalls()).toHaveLength(0);
    expect(structureGate(result.decision, 'COST_BASIS_UNAVAILABLE')?.explanation).toBe('held quantity invalid');
  });

  it('quantity "1" with a floor-failed short (cost 131.40 makes 381.40 = 381.40): not ready, no order body', async () => {
    heldItem = positionItem({ 'average-open-price': '131.40' });
    const result = await submitHeldPmccShortCallOrder('user-a', sell(1));
    expect(result.order).toBeNull();
    expect(result.decision.action).toBe('BLOCKED');
    expect(result.decision.qualification).toBe('DISQUALIFIED');
    expect(orderCalls()).toHaveLength(0);
    expect(structureGate(result.decision, 'SHORT_NOT_ABOVE_HELD_BREAKEVEN')).toBeDefined();
  });

  it('+0.01 on the floor is ready again (boundary is exact on the server path)', async () => {
    heldItem = positionItem({ 'average-open-price': '131.39' });
    const result = await submitHeldPmccShortCallOrder('user-a', sell(1));
    expect(result.decision.action).toBe('HELD_PMCC_REVIEW_ONLY');
    expect(orderCalls()).toHaveLength(1);
  });

  it('a missing or unusable broker cost is not ready and never sends an order: missing, "0", "" and the raw exponent string "1e2"', async () => {
    for (const cost of [undefined, null, '0', '', '1e2', 'abc']) {
      fetchMock.mockClear();
      heldItem = positionItem({ 'average-open-price': cost });
      const result = await submitHeldPmccShortCallOrder('user-a', sell(1));
      expect(result.order, `cost ${String(cost)}`).toBeNull();
      expect(orderCalls(), `cost ${String(cost)}`).toHaveLength(0);
      expect(structureGate(result.decision, 'COST_BASIS_UNAVAILABLE')?.explanation, `cost ${String(cost)}`).toBe('cost basis unavailable');
    }
  });

  it('the guard reads the broker-fetched held quantity, never the sell quantity: held 3, sell 1 is blocked; held 1, sell 1 is allowed', async () => {
    heldItem = positionItem({ quantity: '3' });
    expect((await submitHeldPmccShortCallOrder('user-a', sell(1))).order).toBeNull();
    heldItem = positionItem({ quantity: '1' });
    expect((await submitHeldPmccShortCallOrder('user-a', sell(1))).order).not.toBeNull();
  });
});
