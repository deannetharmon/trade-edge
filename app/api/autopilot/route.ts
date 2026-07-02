// app/api/autopilot/route.ts

import { NextResponse } from 'next/server';
import { resolveAutopilotUserId } from '@/lib/autopilot/auth';
import { getAutopilotSnapshot } from '@/lib/autopilot/engine';

export async function GET(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json(await getAutopilotSnapshot(userId));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
