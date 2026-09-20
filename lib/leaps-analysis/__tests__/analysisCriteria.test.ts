// lib/leaps-analysis/__tests__/analysisCriteria.test.ts
//
// LEAPS-AI-0003 -- Analyze with AI is judged against the trader's scan filters, and prior-session
// quotes are capped at 5 calendar days. Order/review paths are covered in marketAwareFreshness.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ioredis', () => ({
  default: class FakeRedis {
    hgetall = vi.fn(async () => ({ refresh_token: 'r', client_secret: 's' }));
    hset = vi.fn(async () => 1);
    disconnect = vi.fn();
  },
}));
vi.mock('@/lib/crypto', () => ({ decrypt: (value: string) => value, encrypt: (value: string) => value }));

import { buildSnapshot, isAnalysisEligible, LEAPS_ANALYSIS_SNAPSHOT_VERSION, snapshotCriteria } from '../analysisService';
import { resolveAnalysisCriteria, resolveLeapsCriteria } from '../criteria';
import { resolveLeapsContractEvidence } from '../serverTradeReview';

const OCC = 'GOOGL 270617C00250000';
const fetchMock = vi.fn();
const SUNDAY = '2026-09-20T06:25:39.922Z';
const before = (iso: string, ms: number) => new Date(Date.parse(iso) - ms).toISOString();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

function stubBroker(opts: { optionAt: string | null; underlyingAt: string | null; delta?: number }) {
  fetchMock.mockImplementation(async (url: string) => {
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/oauth/token')) return json({ access_token: 'token' });
    if (url.includes('/option-chains/')) {
      return json({ data: { items: [{ expirations: [{ 'expiration-date': '2027-06-17', strikes: [{ 'strike-price': '250', call: OCC }] }] }] } });
    }
    if (url.includes('equity-option=')) {
      return json({ data: { items: [{ symbol: OCC, bid: 112.2, ask: 114.9, delta: opts.delta ?? 0.84569266, 'open-interest': 1296, 'updated-at': opts.optionAt }] } });
    }
    if (url.includes('by-type?equity=')) return json({ data: { items: [{ last: 350.858, 'updated-at': opts.underlyingAt }] } });
    throw new Error(`unexpected url ${url}`);
  });
}

const evidence = (criteria?: Parameters<typeof resolveLeapsContractEvidence>[2]) =>
  resolveLeapsContractEvidence('user-1', { underlyingSymbol: 'GOOGL', occSymbol: OCC }, criteria);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('REDIS_URL', 'redis://test');
  vi.stubEnv('TASTYTRADE_CLIENT_ID', 'client-id');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(SUNDAY));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('judged against the trader\'s scan filters', () => {
  const fresh = { optionAt: '2026-09-19T09:46:19.656Z', underlyingAt: '2026-09-19T10:58:05.321Z' };

  it('a delta-0.65 contract fails the fixed policy but qualifies under filters that allow it', async () => {
    stubBroker({ ...fresh, delta: 0.65 });

    const fixed = await evidence();
    expect(fixed.qualification.status).toBe('NOT_QUALIFIED');

    const { criteria } = resolveAnalysisCriteria({ deltaMin: 0.6, deltaMax: 0.9, dteMin: 180, oiMin: 100, extrinsicPctMax: 20 });
    const filtered = await evidence(criteria);
    expect(filtered.qualification.status).toBe('CONTRACT_QUALIFIED');
  });

  it('a contract that fails the trader\'s own filters does not qualify', async () => {
    stubBroker({ ...fresh });
    const { criteria } = resolveAnalysisCriteria({ deltaMin: 0.9, deltaMax: 0.95, dteMin: 180, oiMin: 100, extrinsicPctMax: 20 });

    const review = await evidence(criteria);

    expect(review.qualification.status).toBe('NOT_QUALIFIED');
    expect(isAnalysisEligible(review.qualification.status)).toBe(false);
  });

  it('with no extrinsic ceiling (Any) the status is REVIEW_REQUIRED, which is analysis-eligible', async () => {
    stubBroker({ ...fresh });
    const criteria = resolveLeapsCriteria({ deltaMin: 0.7, deltaMax: 0.85, dteMin: 180, oiMin: 100, extrinsicPctMax: 0 });

    const review = await evidence(criteria);

    expect(review.qualification.status).toBe('REVIEW_REQUIRED');
    expect(isAnalysisEligible(review.qualification.status)).toBe(true);
  });

  it('only qualified and discovery-mode review statuses are eligible', () => {
    expect(isAnalysisEligible('CONTRACT_QUALIFIED')).toBe(true);
    expect(isAnalysisEligible('REVIEW_REQUIRED')).toBe(true);
    expect(isAnalysisEligible('NOT_QUALIFIED')).toBe(false);
    expect(isAnalysisEligible('DATA_UNAVAILABLE')).toBe(false);
  });
});

describe('prior-session quote age cap (5 calendar days)', () => {
  it('accepts quotes 4 days 20 hours old', async () => {
    const at = before(SUNDAY, 4 * DAY + 20 * HOUR);
    stubBroker({ optionAt: at, underlyingAt: at });

    const review = await evidence();

    expect(review.qualification.status).toBe('CONTRACT_QUALIFIED');
    expect(review.quoteBasis).toBe('last_session');
  });

  it('rejects quotes 5 days and 1 minute old and says why', async () => {
    const at = before(SUNDAY, 5 * DAY + MINUTE);
    stubBroker({ optionAt: at, underlyingAt: at });

    const review = await evidence();

    expect(review.qualification.status).toBe('DATA_UNAVAILABLE');
    expect(review.quoteBasis).toBe('live');
    expect(review.qualification.gates.find(gate => gate.id === 'freshness')?.message).toBe('Quotes are more than 5 days old');
  });

  it('rejects when either timestamp is older than the cap', async () => {
    stubBroker({ optionAt: before(SUNDAY, 2 * DAY), underlyingAt: before(SUNDAY, 6 * DAY) });

    const review = await evidence();

    expect(review.qualification.status).toBe('DATA_UNAVAILABLE');
  });

  it('asks for timestamps when one is missing', async () => {
    stubBroker({ optionAt: null, underlyingAt: before(SUNDAY, DAY) });

    const review = await evidence();

    expect(review.qualification.status).toBe('DATA_UNAVAILABLE');
    expect(review.qualification.gates.find(gate => gate.id === 'freshness')?.message).toBe('Option and underlying quote timestamps are required');
  });
});

describe('snapshot', () => {
  it('records the criteria the analysis was judged against (version v3)', async () => {
    const at = before(SUNDAY, DAY);
    stubBroker({ optionAt: at, underlyingAt: at });
    const { criteria, source } = resolveAnalysisCriteria({ deltaMin: 0.6, deltaMax: 0.9, dteMin: 200, dteMax: 700, oiMin: 50, extrinsicPctMax: 12 });
    const review = await evidence(criteria);

    const snapshot = buildSnapshot(review, 'not_specified', 1, '', snapshotCriteria(criteria, source));

    expect(snapshot.version).toBe(LEAPS_ANALYSIS_SNAPSHOT_VERSION);
    expect(LEAPS_ANALYSIS_SNAPSHOT_VERSION).toBe('leaps-analysis-snapshot-v3');
    expect(snapshot.criteria).toEqual({ deltaMin: 0.6, deltaMax: 0.9, dteMin: 200, dteMax: 700, oiMin: 50, extrinsicPctMax: 12, spreadPctMax: 10, source: 'scan_filters' });
  });

  it('records null criteria when none are supplied (older callers)', async () => {
    const at = before(SUNDAY, DAY);
    stubBroker({ optionAt: at, underlyingAt: at });
    const review = await evidence();

    expect(buildSnapshot(review, 'not_specified', 1, '').criteria).toBeNull();
  });
});
