// app/api/paper-trading/intelligence/route.ts
//
// PT-0001 section 13: read-only Portfolio Intelligence summary for the
// user's open PAPER positions only, via the canonical adapter. Real
// positions are never read or referenced by this route.

import { NextResponse } from 'next/server';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';
import { paperErrorResponse } from '@/lib/paper-trading/http';
import { getPaperTradingLedger } from '@/lib/paper-trading/persistence/store';
import { buildPaperPortfolioIntelligence } from '@/lib/paper-trading/adapters/portfolioIntelligenceAdapter';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const ledger = await getPaperTradingLedger(userId);
    const summary = buildPaperPortfolioIntelligence(ledger.openPositions);
    return NextResponse.json({ summary });
  } catch (e) {
    return paperErrorResponse(e);
  }
}
