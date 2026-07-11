// app/api/autopilot/recommendations/route.ts
//
// Phase 2 of the screener bridge: this is the first route that actually
// evaluates real market data through the recommendation engine. The client
// (the screener page, after running a normal scan) POSTs its ScreenResult[]
// here; this route converts them via screenResultsToAutopilotCandidates()
// and runs them through the full pipeline (candidate validation -> portfolio
// pre-gates -> shared decision-engine reasoning -> persistence -> audit
// trail).
//
// Still true after this route exists:
//   - No paper positions are opened. No live orders are placed.
//   - Every DecisionAnalysis carries executionAllowed: false and
//     paperExecutionAllowed: false.
//   - This does not wire anything into the cron job -- frameworkRunner.ts
//     (used by /api/autopilot/run and cron) still passes candidates: [].
//     Automatic, unattended candidate generation is a separate piece of
//     work (it would need the cron job to run the screener itself, which
//     needs a tastytrade-authenticated context cron doesn't have today).

import { NextResponse } from 'next/server';
import { runRecommendationEngine } from '@/lib/autopilot/decision/recommendationEngine';
import { screenResultsToAutopilotCandidates } from '@/lib/autopilot/decision/screenerCandidateAdapter';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';
import type { ScreenResult } from '@/lib/scans/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const screenResults = Array.isArray(body?.screenResults) ? (body.screenResults as ScreenResult[]) : [];
    const quantity = Number.isFinite(body?.quantity) ? Number(body.quantity) : 1;

    if (!screenResults.length) {
      return NextResponse.json({ error: 'screenResults is required and must be a non-empty array.' }, { status: 400 });
    }

    const { candidates, skipped } = screenResultsToAutopilotCandidates(screenResults, quantity);

    const result = await runRecommendationEngine(userId, {
      source: 'screener',
      candidates,
    });

    return NextResponse.json({
      success: true,
      mode: 'paper',
      liveTradingEnabled: false,
      result,
      skipped, // candidates the adapter couldn't/wouldn't convert (e.g. PMCC), with reasons
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
