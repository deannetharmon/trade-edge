// app/api/autopilot/config-index/route.ts

import { NextResponse } from 'next/server';
import { getAutopilotConfig, getAutopilotConfigAudit, saveAutopilotConfig } from '@/lib/autopilot/persistence/configStore';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const [config, audit] = await Promise.all([getAutopilotConfig(userId), getAutopilotConfigAudit(userId, 25)]);
    return NextResponse.json({ config, audit });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json();
    const config = await saveAutopilotConfig(userId, body?.config ?? body, body?.reason ?? 'api_update');
    return NextResponse.json({ success: true, config });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
