// app/api/paper-trading/positions/route.ts
//
// PT-0001: open a new manual paper position. Thin route -- validates shape
// of the request body only (types, presence), resolves the user
// server-side, and delegates all domain rules (strategy validation,
// pricing, capital, idempotency, audit) to lib/paper-trading/service.ts.

import { NextResponse } from 'next/server';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';
import { paperErrorResponse } from '@/lib/paper-trading/http';
import { openPaperPosition } from '@/lib/paper-trading/service';
import type { PaperLeg, PaperManualFillOverride, PaperQuoteSnapshot, PaperStrategy } from '@/lib/paper-trading/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : null;
    if (!idempotencyKey) return NextResponse.json({ error: 'idempotencyKey is required' }, { status: 400 });

    const result = await openPaperPosition({
      userId,
      idempotencyKey,
      symbol: String(body?.symbol ?? ''),
      strategy: body?.strategy as PaperStrategy,
      legs: (body?.legs ?? []) as PaperLeg[],
      expiration: String(body?.expiration ?? ''),
      quantity: Number(body?.quantity),
      quoteSnapshot: (body?.quoteSnapshot ?? null) as PaperQuoteSnapshot | null,
      staleConfirmed: Boolean(body?.staleConfirmed),
      manualOverride: (body?.manualOverride ?? null) as PaperManualFillOverride | null,
      entryRationale: typeof body?.entryRationale === 'string' ? body.entryRationale : null,
    });

    return NextResponse.json(result);
  } catch (e) {
    return paperErrorResponse(e);
  }
}
