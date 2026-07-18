// app/api/autopilot/paper-account/route.ts
//
// PT-0001 note: this route is the Autopilot Decision Engine's OWN dormant
// paper-account framework (currentBalance/peakBalance/openPositions -- see
// lib/autopilot/types.ts's PaperAccount). It is unrelated to, and untouched
// by, PT-0001's Manual Paper Trading Sandbox, which reads/writes only the
// separate `paperTrading` field on this same Redis record (see
// lib/paper-trading/persistence/store.ts). resetPaperAccount() below was
// updated so this route's reset can no longer silently delete a user's
// PT-0001 ledger -- see paperAccountStore.ts's resetPaperAccount() doc
// comment. PT-0001's own account endpoints live under /api/paper-trading/*.

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
