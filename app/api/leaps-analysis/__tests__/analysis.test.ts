// app/api/leaps-analysis/__tests__/analysis.test.ts
//
// LEAPS-AI-0003 -- POST /api/leaps-analysis judges the contract against the trader's scan filters,
// runs the model only for qualified or discovery-mode (REVIEW_REQUIRED) contracts, and never calls
// the model for NOT_QUALIFIED or DATA_UNAVAILABLE.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateLeapsEntry, type LeapsEntryCriteria } from '@/lib/scans/leapsEntryQualification';

const getServerSession = vi.fn();
const resolveMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/leaps-analysis/serverTradeReview', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/leaps-analysis/serverTradeReview')>()),
  resolveLeapsContractEvidence: (...args: unknown[]) => resolveMock(...args),
}));
vi.mock('@/lib/leaps-analysis/analysisService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/leaps-analysis/analysisService')>()),
  redisForAnalysis: () => ({ disconnect: vi.fn() }),
  claimAnalysis: async () => ({ cachedId: null }),
  saveAnalysisRecord: async () => undefined,
}));

const OCC = 'GOOGL 270617C00250000';
const NOW = '2026-09-21T15:00:00.000Z';

function review(criteria: LeapsEntryCriteria, delta = 0.84569266) {
  const qualification = evaluateLeapsEntry({
    occSymbol: OCC, strike: 250, dte: 270, delta, openInterest: 1296, bid: 112.2, ask: 114.9, underlyingPrice: 350.858, quoteTimestamp: NOW,
  }, criteria);
  return {
    qualification, occSymbol: OCC, symbol: 'GOOGL', strike: 250, expiration: '2027-06-17', dte: 270, bid: 112.2, ask: 114.9, spot: 350.858, delta,
    openInterest: 1296, impliedVolatility: 0.485, optionQuoteTimestamp: NOW, underlyingQuoteTimestamp: NOW, instrumentType: 'Equity Option',
    multiplier: 100, provider: 'tastytrade', fetchedAt: NOW, marketSession: 'open', quoteBasis: 'live',
  };
}

const modelOutput = {
  posture: 'INSUFFICIENT_EVIDENCE', evidence: [{ field: 'contract.delta', fact: 'Delta is high, so the call behaves much like the stock.' }],
  inferences: [{ statement: 'Extrinsic value is a modest share of the cost.', uncertainty: 'Depends on implied volatility staying stable.' }],
  mechanics: 'Mostly intrinsic value with a small time premium.', tradeoffs: 'Lower time premium in exchange for more capital tied up.', cautions: [], missing: [],
};

function post(body: Record<string, unknown>) {
  return { json: async () => ({ underlyingSymbol: 'GOOGL', occSymbol: OCC, intent: 'not_specified', quantity: 1, objective: '', idempotencyKey: 'abcdefghijklmnop1234', ...body }) } as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  getServerSession.mockReset(); getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
  resolveMock.mockReset(); fetchMock.mockReset();
  resolveMock.mockImplementation(async (_user: string, _input: unknown, criteria: LeapsEntryCriteria) => review(criteria));
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ model: 'gpt-4o-mini', choices: [{ message: { content: JSON.stringify(modelOutput) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }) });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('LEAPS_ADVISOR_ENABLED', 'true');
  vi.stubEnv('OPENAI_API_KEY', 'test-key');
  vi.stubEnv('LEAPS_ANALYSIS_MODEL', 'gpt-4o-mini');
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const FILTERS = { deltaMin: 0.7, deltaMax: 0.85, dteMin: 180, dteMax: 730, oiMin: 100, extrinsicPctMax: 20 };

describe('POST /api/leaps-analysis criteria', () => {
  it('passes the trader\'s scan filters to the evidence resolver and records them in the snapshot', async () => {
    const { POST } = await import('../route');

    const res = await POST(post({ ...FILTERS, deltaMin: 0.6, extrinsicPctMax: 15 }));
    const body = await res.json();

    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock.mock.calls[0][2]).toMatchObject({ deltaMin: 0.6, deltaMax: 0.85, dteMin: 180, dteMax: 730, oiMin: 100, extrinsicPctMax: 15 });
    expect(body.snapshot.criteria).toMatchObject({ source: 'scan_filters', deltaMin: 0.6, extrinsicPctMax: 15 });
    expect(body.snapshot.version).toBe('leaps-analysis-snapshot-v3');
  });

  it('keeps the fixed server policy when the request carries no filters', async () => {
    const { POST } = await import('../route');

    const res = await POST(post({}));
    const body = await res.json();

    expect(body.snapshot.criteria).toMatchObject({ source: 'server_default', deltaMin: 0.7, deltaMax: 0.85, extrinsicPctMax: 20 });
  });
});

describe('POST /api/leaps-analysis eligibility (decision D-A)', () => {
  it('runs the model for a qualified contract', async () => {
    const { POST } = await import('../route');

    const res = await POST(post(FILTERS));
    const body = await res.json();

    expect(body.snapshot.qualification.status).toBe('CONTRACT_QUALIFIED');
    expect(body.status).toBe('MECHANICS_REVIEWED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('runs the model in discovery mode (no extrinsic ceiling) for REVIEW_REQUIRED', async () => {
    const { POST } = await import('../route');

    const res = await POST(post({ ...FILTERS, extrinsicPctMax: 0 }));
    const body = await res.json();

    expect(body.snapshot.qualification.status).toBe('REVIEW_REQUIRED');
    expect(body.status).toBe('MECHANICS_REVIEWED');
    expect(body.snapshot.criteria.extrinsicPctMax).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never calls the model for NOT_QUALIFIED', async () => {
    const { POST } = await import('../route');

    const res = await POST(post({ ...FILTERS, deltaMin: 0.9, deltaMax: 0.95 }));
    const body = await res.json();

    expect(body.snapshot.qualification.status).toBe('NOT_QUALIFIED');
    expect(body.status).toBe('MORE_INFORMATION_NEEDED');
    expect(body.output).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never calls the model for DATA_UNAVAILABLE', async () => {
    resolveMock.mockImplementation(async (_user: string, _input: unknown, criteria: LeapsEntryCriteria) => {
      const base = review(criteria);
      return { ...base, qualification: evaluateLeapsEntry({ occSymbol: OCC, strike: 250, dte: 270, delta: 0.84, openInterest: 1296, bid: 115, ask: 112, underlyingPrice: 350.858, quoteTimestamp: NOW }, criteria) };
    });
    const { POST } = await import('../route');

    const res = await POST(post(FILTERS));
    const body = await res.json();

    expect(body.snapshot.qualification.status).toBe('DATA_UNAVAILABLE');
    expect(body.status).toBe('MORE_INFORMATION_NEEDED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
