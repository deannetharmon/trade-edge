// app/api/paper-trading/positions/[positionId]/close/route.ts
//
// PT-0001: manually close a full paper position. Full close only in Phase 1
// (no partial closes -- see docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md
// "Explicitly out of scope").

import { NextResponse } from 'next/server';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';
import { paperErrorResponse, parseManualOverrideInput } from '@/lib/paper-trading/http';
import { closePaperPosition } from '@/lib/paper-trading/service';
import type { PaperQuoteSnapshot } from '@/lib/paper-trading/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: { positionId: string } }) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : null;
    if (!idempotencyKey) return NextResponse.json({ error: 'idempotencyKey is required' }, { status: 400 });

    const result = await closePaperPosition({
      userId,
      idempotencyKey,
      positionId: params.positionId,
      quoteSnapshot: (body?.quoteSnapshot ?? null) as PaperQuoteSnapshot | null,
      staleConfirmed: Boolean(body?.staleConfirmed),
      // Never trust a caller-supplied confirmedByUser/confirmedAt -- see
      // parseManualOverrideInput() and service.ts's resolveManualOverride().
      manualOverride: parseManualOverrideInput(body),
    });

    return NextResponse.json(result);
  } catch (e) {
    return paperErrorResponse(e);
  }
}
