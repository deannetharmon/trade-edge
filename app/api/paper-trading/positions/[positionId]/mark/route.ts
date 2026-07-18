// app/api/paper-trading/positions/[positionId]/mark/route.ts
//
// PT-0001 section 12: explicit mark refresh for an open paper position.
// Accepts a client-supplied quote snapshot (or, honestly, a manual mark
// entry) -- there is no server-side TastyTrade call here, consistent with
// the sprint's constraint against reintroducing server-side broker auth.
// Not idempotency-guarded (see service.ts's refreshPaperMark doc comment).

import { NextResponse } from 'next/server';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';
import { paperErrorResponse, parseManualOverrideInput } from '@/lib/paper-trading/http';
import { refreshPaperMark } from '@/lib/paper-trading/service';
import type { PaperQuoteSnapshot } from '@/lib/paper-trading/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: { positionId: string } }) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));

    const result = await refreshPaperMark({
      userId,
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
