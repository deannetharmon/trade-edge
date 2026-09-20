// lib/leaps-analysis/__tests__/marketAwareFreshness.test.ts
//
// LEAPS-AI-0002 -- Analyze with AI uses market-aware quote freshness; every
// order/review path keeps the strict 60-second rule unchanged.
//
// Fixture values mirror a real GOOGL 250C 2027-06-17 response captured on a
// weekend (option quote ~20 h old, stock quote ~19 h old, every other gate passing).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ioredis', () => ({
  default: class FakeRedis {
    hgetall = vi.fn(async () => ({ refresh_token: 'r', client_secret: 's' }));
    hset = vi.fn(async () => 1);
    disconnect = vi.fn();
  },
}));
vi.mock('@/lib/crypto', () => ({ decrypt: (value: string) => value, encrypt: (value: string) => value }));

import { buildSnapshot, LEAPS_ANALYSIS_SNAPSHOT_VERSION } from '../analysisService';
import { resolveLeapsContractEvidence, reviewLeapsContract } from '../serverTradeReview';

const OCC = 'GOOGL 270617C00250000';
const fetchMock = vi.fn();

type Quote = { optionAt: string | null; underlyingAt: string | null; bid?: number; ask?: number };

function stubBroker(quote: Quote) {
  fetchMock.mockImplementation(async (url: string) => {
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/oauth/token')) return json({ access_token: 'token' });
    if (url.includes('/customers/me/accounts')) return json({ data: { items: [{ account: { 'account-number': 'ACC1' } }] } });
    if (url.includes('/option-chains/')) {
      return json({ data: { items: [{ expirations: [{ 'expiration-date': '2027-06-17', strikes: [{ 'strike-price': '250', call: OCC }] }] }] } });
    }
    if (url.includes('equity-option=')) {
      return json({ data: { items: [{ symbol: OCC, bid: quote.bid ?? 112.2, ask: quote.ask ?? 114.9, delta: 0.84569266, 'open-interest': 1296, 'updated-at': quote.optionAt }] } });
    }
    if (url.includes('by-type?equity=')) return json({ data: { items: [{ last: 350.858, 'updated-at': quote.underlyingAt }] } });
    throw new Error(`unexpected url ${url}`);
  });
}

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const minusSeconds = (iso: string, seconds: number) => new Date(Date.parse(iso) - seconds * 1000).toISOString();

const SUNDAY = '2026-09-20T06:25:39.922Z';
const MONDAY_OPEN = '2026-09-21T15:00:00.000Z'; // 11:00 ET, regular session
const HOLIDAY = '2026-07-03T15:00:00.000Z'; // Independence Day observed

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('REDIS_URL', 'redis://test');
  vi.stubEnv('TASTYTRADE_CLIENT_ID', 'client-id');
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Analyze with AI: market closed', () => {
  it('accepts the broker\'s last two-sided quote as a prior-session snapshot on a weekend', async () => {
    at(SUNDAY);
    stubBroker({ optionAt: '2026-09-19T09:46:19.656Z', underlyingAt: '2026-09-19T10:58:05.321Z' });

    const review = await resolveLeapsContractEvidence('user-1', { underlyingSymbol: 'GOOGL', occSymbol: OCC });

    expect(review.qualification.status).toBe('CONTRACT_QUALIFIED');
    expect(review.quoteBasis).toBe('last_session');
    expect(review.marketSession).toBe('closed');
  });

  it('treats a market holiday the same way', async () => {
    at(HOLIDAY);
    stubBroker({ optionAt: '2026-07-02T19:59:00.000Z', underlyingAt: '2026-07-02T20:00:00.000Z' });

    const review = await resolveLeapsContractEvidence('user-1', { underlyingSymbol: 'GOOGL', occSymbol: OCC });

    expect(review.qualification.status).toBe('CONTRACT_QUALIFIED');
    expect(review.quoteBasis).toBe('last_session');
  });

  it('still rejects a crossed quote', async () => {
    at(SUNDAY);
    stubBroker({ optionAt: '2026-09-19T09:46:19.656Z', underlyingAt: '2026-09-19T10:58:05.321Z', bid: 115, ask: 112 });

    const review = await resolveLeapsContractEvidence('user-1', { underlyingSymbol: 'GOOGL', occSymbol: OCC });

    expect(review.qualification.status).toBe('DATA_UNAVAILABLE');
  });

  it('still fails a spread wider than the policy limit', async () => {
    at(SUNDAY);
    stubBroker({ optionAt: '2026-09-19T09:46:19.656Z', underlyingAt: '2026-09-19T10:58:05.321Z', bid: 100, ask: 130 });

    const review = await resolveLeapsContractEvidence('user-1', { underlyingSymbol: 'GOOGL', occSymbol: OCC });

    expect(review.qualification.status).toBe('NOT_QUALIFIED');
  });

  it('still requires both quote timestamps to exist', async () => {
    at(SUNDAY);
    stubBroker({ optionAt: null, underlyingAt: '2026-09-19T10:58:05.321Z' });

    const review = await resolveLeapsContractEvidence('user-1', { underlyingSymbol: 'GOOGL', occSymbol: OCC });

    expect(review.qualification.status).toBe('DATA_UNAVAILABLE');
    expect(review.quoteBasis).toBe('live');
  });
});

describe('Analyze with AI: market open', () => {
  it('accepts quotes up to 300 seconds old', async () => {
    at(MONDAY_OPEN);
    stubBroker({ optionAt: minusSeconds(MONDAY_OPEN, 200), underlyingAt: minusSeconds(MONDAY_OPEN, 5) });

    const review = await resolveLeapsContractEvidence('user-1', { underlyingSymbol: 'GOOGL', occSymbol: OCC });

    expect(review.qualification.status).toBe('CONTRACT_QUALIFIED');
    expect(review.quoteBasis).toBe('live');
    expect(review.marketSession).toBe('open');
  });

  it('rejects a quote older than 300 seconds and says why', async () => {
    at(MONDAY_OPEN);
    stubBroker({ optionAt: minusSeconds(MONDAY_OPEN, 400), underlyingAt: minusSeconds(MONDAY_OPEN, 5) });

    const review = await resolveLeapsContractEvidence('user-1', { underlyingSymbol: 'GOOGL', occSymbol: OCC });

    expect(review.qualification.status).toBe('DATA_UNAVAILABLE');
    const gate = review.qualification.gates.find(item => item.id === 'freshness');
    expect(gate?.message).toContain('300 seconds');
    expect(gate?.message).toContain('while the market is open');
  });
});

describe('order and review paths stay strict (60 seconds)', () => {
  it('rejects a 200-second-old quote while the market is open', async () => {
    at(MONDAY_OPEN);
    stubBroker({ optionAt: minusSeconds(MONDAY_OPEN, 200), underlyingAt: minusSeconds(MONDAY_OPEN, 5) });

    const { review, context } = await reviewLeapsContract('user-1', { accountLocator: null, underlyingSymbol: 'GOOGL', occSymbol: OCC });
    context.redis.disconnect();

    expect(review.qualification.status).toBe('DATA_UNAVAILABLE');
    expect(review.qualification.gates.find(item => item.id === 'freshness')?.message).toBe('Option and underlying quotes must both be no more than 60 seconds old');
    expect(review.quoteBasis).toBe('live');
  });

  it('does not accept prior-session quotes on a weekend', async () => {
    at(SUNDAY);
    stubBroker({ optionAt: '2026-09-19T09:46:19.656Z', underlyingAt: '2026-09-19T10:58:05.321Z' });

    const { review, context } = await reviewLeapsContract('user-1', { accountLocator: null, underlyingSymbol: 'GOOGL', occSymbol: OCC });
    context.redis.disconnect();

    expect(review.qualification.status).toBe('DATA_UNAVAILABLE');
    expect(review.quoteBasis).toBe('live');
  });

  it('accepts a 30-second-old quote', async () => {
    at(MONDAY_OPEN);
    stubBroker({ optionAt: minusSeconds(MONDAY_OPEN, 30), underlyingAt: minusSeconds(MONDAY_OPEN, 5) });

    const { review, context } = await reviewLeapsContract('user-1', { accountLocator: null, underlyingSymbol: 'GOOGL', occSymbol: OCC });
    context.redis.disconnect();

    expect(review.qualification.status).toBe('CONTRACT_QUALIFIED');
  });
});

describe('snapshot', () => {
  it('records the quote basis, market session, and freshness policy', async () => {
    at(SUNDAY);
    stubBroker({ optionAt: '2026-09-19T09:46:19.656Z', underlyingAt: '2026-09-19T10:58:05.321Z' });
    const review = await resolveLeapsContractEvidence('user-1', { underlyingSymbol: 'GOOGL', occSymbol: OCC });

    const snapshot = buildSnapshot(review, 'not_specified', 1, '');

    expect(snapshot.version).toBe(LEAPS_ANALYSIS_SNAPSHOT_VERSION);
    expect(snapshot.contract.quoteBasis).toBe('last_session');
    expect(snapshot.contract.marketSession).toBe('closed');
    expect(snapshot.provenance.freshnessPolicy).toBe('analysis-market-aware-v1');
    expect(snapshot.unavailable).toEqual([]);
  });
});
