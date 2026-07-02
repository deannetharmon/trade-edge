// app/api/autopilot/paper-account/route.ts

import { NextResponse } from 'next/server';
import { getPaperAccount, resetPaperAccount } from '@/lib/autopilot/persistence/paperAccountStore';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const account = await getPaperAccount(userId);
    return NextResponse.json({ account });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const startingBalance = Number.isFinite(Number(body?.startingBalance)) ? Number(body.startingBalance) : undefined;
    const account = await resetPaperAccount(userId, startingBalance);
    return NextResponse.json({ success: true, account });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
