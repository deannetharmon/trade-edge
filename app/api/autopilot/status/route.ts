// app/api/autopilot/status/route.ts

import { NextResponse } from 'next/server';
import { getAutopilotConfig } from '@/lib/autopilot/persistence/configStore';
import { getPaperAccount } from '@/lib/autopilot/persistence/paperAccountStore';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [config, account] = await Promise.all([
      getAutopilotConfig(userId),
      getPaperAccount(userId),
    ]);

    return NextResponse.json({
      mode: 'paper',
      liveTradingEnabled: false,
      killSwitchEnabled: config.killSwitchEnabled,
      openPositions: account.openPositions.length,
      closedPositions: account.closedPositions.length,
      currentBalance: account.currentBalance,
      peakBalance: account.peakBalance,
      lastRunAt: account.lastRunAt ?? null,
      updatedAt: account.updatedAt,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
