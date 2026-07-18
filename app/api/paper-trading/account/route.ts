// app/api/paper-trading/account/route.ts
//
// PT-0001: GET the authenticated user's paper-trading ledger + derived view.
// Thin route -- resolves the user server-side, calls the domain service,
// returns structured JSON. No accounting math lives here.

import { NextResponse } from 'next/server';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';
import { paperErrorResponse } from '@/lib/paper-trading/http';
import { getPaperTradingLedger } from '@/lib/paper-trading/persistence/store';
import { deriveLedgerView } from '@/lib/paper-trading/ledger';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const ledger = await getPaperTradingLedger(userId);
    const view = deriveLedgerView(ledger);
    return NextResponse.json({ view });
  } catch (e) {
    return paperErrorResponse(e);
  }
}
