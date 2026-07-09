// app/api/autopilot/run/route.ts

import { NextResponse } from 'next/server';
import { runAutopilotFrameworkDryRun } from '@/lib/autopilot/engine';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const result = await runAutopilotFrameworkDryRun(userId, { source: 'manual' });
    return NextResponse.json({ success: true, mode: 'paper', liveTradingEnabled: false, result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
