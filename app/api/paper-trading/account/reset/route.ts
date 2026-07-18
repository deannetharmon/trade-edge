// app/api/paper-trading/account/reset/route.ts
//
// PT-0001: destructive reset of the authenticated user's PAPER ledger only.
// Requires an idempotency key (section 9.1) and a validated starting
// balance. Never touches real positions, the Trade Log, broker data, or
// another user's ledger -- resolveAutopilotUserId ignores any caller-
// supplied user id and resets only that resolved user's own record.

import { NextResponse } from 'next/server';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';
import { paperErrorResponse } from '@/lib/paper-trading/http';
import { resetPaperLedger } from '@/lib/paper-trading/service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : null;
    if (!idempotencyKey) return NextResponse.json({ error: 'idempotencyKey is required' }, { status: 400 });

    const startingBalance = Number(body?.startingBalance);

    const result = await resetPaperLedger({ userId, idempotencyKey, startingBalance });
    return NextResponse.json(result);
  } catch (e) {
    return paperErrorResponse(e);
  }
}
