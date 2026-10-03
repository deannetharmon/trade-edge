// app/api/fundamentals/route.ts

// LEAPS-QV-0001 Gate 2b -- SEC-backed normalized fundamentals for one ticker. Requires a signed-in session. Server-side
// only: SEC EDGAR and Yahoo are fetched here. Nothing calls this route yet (Find LEAPS is unchanged).

import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';
import { fetchYahooPriceHistory, handleFundamentalsRequest } from '@/lib/fundamentals/handler';
import { getSecClient } from '@/lib/fundamentals/sec/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userId = await requireSessionUserId();
  const { status, body } = await handleFundamentalsRequest(req.nextUrl.searchParams.get('symbol'), {
    userId,
    client: getSecClient(),
    fetchPriceHistory: (symbol) => fetchYahooPriceHistory(symbol),
    nowIso: () => new Date().toISOString(),
  });
  return NextResponse.json(body, { status });
}
