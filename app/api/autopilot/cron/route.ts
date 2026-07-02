// app/api/autopilot/cron/route.ts

import { NextResponse } from 'next/server';
import { runAutopilotFrameworkDryRun } from '@/lib/autopilot/engine';

export const dynamic = 'force-dynamic';

function isCronAuthorized(request: Request): boolean {
  const configured = process.env.AUTOPILOT_CRON_SECRET;
  if (!configured) return false;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const header = request.headers.get('x-autopilot-cron-secret');
  return bearer === configured || header === configured;
}

export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = process.env.AUTOPILOT_CRON_USER_ID;
    if (!userId) {
      return NextResponse.json({ error: 'AUTOPILOT_CRON_USER_ID not configured' }, { status: 500 });
    }

    const result = await runAutopilotFrameworkDryRun(userId, { source: 'cron' });
    return NextResponse.json({ success: true, mode: 'paper', liveTradingEnabled: false, result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
