import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const broker = vi.hoisted(() => ({ ttFetch: vi.fn(), getAccessToken: vi.fn() }));

vi.mock('@/lib/tastytrade/client', () => ({
  BASE: 'https://api.tastytrade.com', CLIENT_ID: 'test',
  getAccessToken: broker.getAccessToken, ttFetch: broker.ttFetch,
}));

import { loadPositions } from '../acquisition';
import {
  toWholePositionDeltaShares,
  toWholePositionGammaShareEquivalent,
  toWholePositionThetaDollars,
  toWholePositionVegaDollars,
} from '@/lib/portfolio/positionMetrics';

const SHORT = 'MU  260904P00800000';
const LONG = 'MU  260904P00790000';

function leg(symbol: string, direction: 'Short' | 'Long', averageOpenPrice: string) {
  return {
    symbol, 'underlying-symbol': 'MU', 'instrument-type': 'Equity Option',
    'quantity-direction': direction, quantity: '5',
    'average-open-price': averageOpenPrice,
    'expires-at': '2026-09-04T20:00:00.000Z', 'created-at': '2026-08-05T15:00:00.000Z',
    multiplier: '100',
  };
}

describe('PM-0002 live acquisition Greek and entry-economics wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T16:00:00.000Z'));
    broker.getAccessToken.mockResolvedValue('token');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('position-entry-snapshots')) return new Response(JSON.stringify({ snapshots: {} }), { status: 200 });
      if (url.includes('position-snapshots')) return new Response(JSON.stringify({ snapshots: {} }), { status: 200 });
      if (url.includes('position-intent')) return new Response(JSON.stringify({ intents: {} }), { status: 200 });
      if (url.includes('position-stop-policies')) return new Response(JSON.stringify({ policies: {} }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('maps realistic broker leg Greeks through loadPositions and dollarizes exactly once for the row', async () => {
    broker.ttFetch.mockImplementation(async (path: string) => {
      if (path === '/customers/me/accounts') return { data: { items: [{ account: { 'account-number': 'A1' } }] } };
      if (path === '/accounts/A1/positions') return { data: { items: [leg(SHORT, 'Short', '2.52'), leg(LONG, 'Long', '0.00')] } };
      if (path.startsWith('/market-data/by-type?equity-option=')) return { data: { items: [
        { symbol: SHORT, bid: '3.00', ask: '3.20', mark: '3.10', theta: '-0.070', gamma: '0.001', delta: '-0.20', vega: '0.080', 'updated-at': '2026-08-11T15:59:30.000Z' },
        { symbol: LONG, bid: '1.40', ask: '1.60', mark: '1.50', theta: '-0.024', gamma: '0.001', delta: '-0.10', vega: '0.050', 'updated-at': '2026-08-11T15:59:35.000Z' },
      ] } };
      if (path.startsWith('/market-data/by-type?equity=MU')) return { data: { items: [{ symbol: 'MU', bid: '861.50', ask: '861.70', mark: '861.60' }] } };
      if (path.startsWith('/market-metrics?')) return { data: { items: [{ symbol: 'MU', 'implied-volatility-index-rank': '0.39', 'implied-volatility': '0.66' }] } };
      if (path.includes('/orders/live')) return { data: { items: [] } };
      if (path.includes('/complex-orders')) return { data: { items: [] } };
      if (path.includes('include-marks=true')) return { data: { items: [] } };
      return { data: { items: [] } };
    });

    const { positions } = await loadPositions();
    expect(positions).toHaveLength(1);
    const pos = positions[0];
    expect(pos).toMatchObject({ symbol: 'MU', strategy: 'BPS', quantity: 5, entryEconomicsComplete: true });
    // Raw aggregates are contract Greeks × signed quantity, without a ×100.
    expect(pos.theta).toBeCloseTo(0.23, 8);
    expect(pos.gamma).toBeCloseTo(0, 8);
    expect(pos.netDelta).toBeCloseTo(0.5, 8);
    expect(pos.netVega).toBeCloseTo(-0.15, 8);
    // Row helpers apply the contract multiplier exactly once and use truthful units.
    expect(toWholePositionThetaDollars(pos.theta)).toBeCloseTo(23, 8);
    expect(toWholePositionGammaShareEquivalent(pos.gamma)).toBeCloseTo(0, 8);
    expect(toWholePositionDeltaShares(pos.netDelta)).toBeCloseTo(50, 8);
    expect(toWholePositionVegaDollars(pos.netVega)).toBeCloseTo(-15, 8);
  });

  it('fails entry-dependent outputs closed when one broker leg omits average-open-price', async () => {
    broker.ttFetch.mockImplementation(async (path: string) => {
      if (path === '/customers/me/accounts') return { data: { items: [{ account: { 'account-number': 'A1' } }] } };
      if (path === '/accounts/A1/positions') return { data: { items: [leg(SHORT, 'Short', '2.52'), leg(LONG, 'Long', undefined as unknown as string)] } };
      if (path.startsWith('/market-data/by-type?equity-option=')) return { data: { items: [
        { symbol: SHORT, bid: '3.00', ask: '3.20', mark: '3.10', theta: '-0.07', gamma: '0.001', delta: '-0.20', vega: '0.08', 'updated-at': '2026-08-11T15:59:30.000Z' },
        { symbol: LONG, bid: '1.40', ask: '1.60', mark: '1.50', theta: '-0.024', gamma: '0.001', delta: '-0.10', vega: '0.05', 'updated-at': '2026-08-11T15:59:35.000Z' },
      ] } };
      if (path.startsWith('/market-data/by-type?equity=MU')) return { data: { items: [{ symbol: 'MU', bid: '861.50', ask: '861.70', mark: '861.60' }] } };
      if (path.startsWith('/market-metrics?')) return { data: { items: [] } };
      return { data: { items: [] } };
    });
    const { positions } = await loadPositions();
    const pos = positions[0];
    expect(pos.entryEconomicsComplete).toBe(false);
    expect(pos.entryCredit).toBeNull();
    expect(pos.entryPriceEffect).toBe('Unknown');
    expect(pos.pnl).toBeNull();
    expect(pos.pop).toBeNull();
    expect(pos.targetPrice).toBe(0);
    expect(pos.hitTarget).toBe(false);
    expect(pos.maxRiskReliable).toBe(false);
    expect(pos.recommendation?.kind).not.toBe('place-gtc');
    expect(pos.identity).toBeNull();
  });

  it('does not fabricate marketable P/L or reliable max risk for a complete but unsupported debit entry', async () => {
    broker.ttFetch.mockImplementation(async (path: string) => {
      if (path === '/customers/me/accounts') return { data: { items: [{ account: { 'account-number': 'A1' } }] } };
      // Long the higher-strike 800P for $2 and short the lower-strike 790P
      // for $1: an economically coherent $1 debit put spread.
      if (path === '/accounts/A1/positions') return { data: { items: [leg(SHORT, 'Long', '2.00'), leg(LONG, 'Short', '1.00')] } };
      if (path.startsWith('/market-data/by-type?equity-option=')) return { data: { items: [
        { symbol: SHORT, bid: '3.00', ask: '3.20', mark: '3.10', theta: '-0.07', gamma: '0.001', delta: '-0.20', vega: '0.08', 'updated-at': '2026-08-11T15:59:30.000Z' },
        { symbol: LONG, bid: '1.40', ask: '1.60', mark: '1.50', theta: '-0.024', gamma: '0.001', delta: '-0.10', vega: '0.05', 'updated-at': '2026-08-11T15:59:35.000Z' },
      ] } };
      if (path.startsWith('/market-data/by-type?equity=MU')) return { data: { items: [{ symbol: 'MU', bid: '861.50', ask: '861.70', mark: '861.60' }] } };
      if (path.startsWith('/market-metrics?')) return { data: { items: [] } };
      return { data: { items: [] } };
    });
    const { positions } = await loadPositions();
    expect(positions[0]).toMatchObject({
      entryEconomicsComplete: true,
      entryPriceEffect: 'Debit',
      closeNowPnl: null,
      maxRiskReliable: false,
    });
  });
});
