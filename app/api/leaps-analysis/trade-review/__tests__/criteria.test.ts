// app/api/leaps-analysis/trade-review/__tests__/criteria.test.ts
//
// LEAPS-AI-0003 -- the order route now takes its criteria from the shared resolveLeapsCriteria.
// Its behavior is unchanged: it always resolves from the request body (no server-default shortcut).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getServerSession = vi.fn();
const submitLeapsOrder = vi.fn();

vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/leaps-analysis/serverTradeReview', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/leaps-analysis/serverTradeReview')>()),
  submitLeapsOrder: (...args: unknown[]) => submitLeapsOrder(...args),
}));

import { resolveLeapsCriteria } from '@/lib/leaps-analysis/criteria';

function post(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  getServerSession.mockReset(); getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
  submitLeapsOrder.mockReset();
  submitLeapsOrder.mockResolvedValue({ review: { qualification: { status: 'CONTRACT_QUALIFIED' } } });
});

describe('POST /api/leaps-analysis/trade-review criteria', () => {
  it('passes exactly resolveLeapsCriteria(body) to submitLeapsOrder', async () => {
    const { POST } = await import('../route');
    const body = { underlyingSymbol: 'googl', occSymbol: 'GOOGL 270617C00250000', quantity: 1, limitPrice: 113.5, mode: 'dry-run', deltaMin: 0.6, deltaMax: 0.9, dteMin: 200, dteMax: 700, oiMin: 50, extrinsicPctMax: 12 };

    const res = await POST(post(body));

    expect(res.status).toBe(200);
    expect(submitLeapsOrder.mock.calls[0][2]).toEqual(resolveLeapsCriteria(body));
  });

  it('keeps "Any" extrinsic (discovery) when the ceiling is omitted, with no server-default shortcut', async () => {
    const { POST } = await import('../route');

    await POST(post({ underlyingSymbol: 'GOOGL', occSymbol: 'GOOGL 270617C00250000', quantity: 1, limitPrice: 113.5 }));

    expect(submitLeapsOrder.mock.calls[0][2].extrinsicPctMax).toBeNull();
  });

  it('still requires a session', async () => {
    getServerSession.mockResolvedValue(null);
    const { POST } = await import('../route');

    const res = await POST(post({}));

    expect(res.status).toBe(401);
    expect(submitLeapsOrder).not.toHaveBeenCalled();
  });
});
