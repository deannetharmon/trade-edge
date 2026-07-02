// app/api/autopilot/health/route.ts

import { NextResponse } from 'next/server';
import { withAutopilotRedis } from '@/lib/autopilot/persistence/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  try {
    const redis = await withAutopilotRedis(async (client) => client.ping());
    return NextResponse.json({
      ok: true,
      service: 'autopilot',
      mode: 'paper',
      redis,
      latencyMs: Date.now() - startedAt,
      liveTradingEnabled: false,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      service: 'autopilot',
      mode: 'paper',
      error: e?.message ?? 'Unknown error',
      latencyMs: Date.now() - startedAt,
      liveTradingEnabled: false,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
