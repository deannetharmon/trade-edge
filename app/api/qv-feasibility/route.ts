// app/api/qv-feasibility/route.ts

// LEAPS-QV-0001 -- read-only feasibility run of the Gate 3 input builder (spec Section 6). Signed-in only.
// Example: /api/qv-feasibility?symbols=UBER,NFLX,META

import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';
import { fetchYahooPriceHistory } from '@/lib/fundamentals/handler';
import { handleQvFeasibility } from '@/lib/fundamentals/qvFeasibility';
import { getSecClient } from '@/lib/fundamentals/sec/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const userId = await requireSessionUserId();
  const { status, body } = await handleQvFeasibility(req.nextUrl.searchParams.get('symbols'), {
    userId,
    client: getSecClient(),
    fetchPriceHistory: (symbol) => fetchYahooPriceHistory(symbol),
    nowIso: () => new Date().toISOString(),
  });
  return NextResponse.json(body, { status });
}
