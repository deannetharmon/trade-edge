// app/api/autopilot/config/route.ts

import { NextResponse } from 'next/server';
import { resolveAutopilotUserId } from '@/lib/autopilot/auth';
import { getAutopilotConfig, saveAutopilotConfig } from '@/lib/autopilot/store';

export async function GET(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const config = await getAutopilotConfig(userId);
    return NextResponse.json({ config });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json();
    const config = await saveAutopilotConfig(userId, body?.config ?? body);
    return NextResponse.json({ config });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
