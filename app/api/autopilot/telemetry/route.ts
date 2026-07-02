// app/api/autopilot/telemetry/route.ts

import { NextResponse } from 'next/server';
import { getTelemetryEvents } from '@/lib/autopilot/persistence/telemetryStore';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? '50');
    const telemetry = await getTelemetryEvents(userId, Number.isFinite(limit) ? limit : 50);
    return NextResponse.json({ telemetry });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
