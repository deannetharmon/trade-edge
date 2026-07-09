// app/api/autopilot/decisions/route.ts

import { NextResponse } from 'next/server';
import { getDecisionLog } from '@/lib/autopilot/persistence/decisionLogStore';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? '100');
    const decisions = await getDecisionLog(userId, Number.isFinite(limit) ? limit : 100);
    return NextResponse.json({ decisions });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
