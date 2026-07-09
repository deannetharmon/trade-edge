// app/api/autopilot/state/route.ts

import { NextResponse } from 'next/server';
import { getAutopilotConfig, getAutopilotConfigAudit } from '@/lib/autopilot/persistence/configStore';
import { getDecisionLog } from '@/lib/autopilot/persistence/decisionLogStore';
import { getPaperAccount } from '@/lib/autopilot/persistence/paperAccountStore';
import { resolveAutopilotUserId } from '@/lib/autopilot/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const userId = await resolveAutopilotUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [config, configAudit, account, decisions] = await Promise.all([
      getAutopilotConfig(userId),
      getAutopilotConfigAudit(userId, 10),
      getPaperAccount(userId),
      getDecisionLog(userId, 25),
    ]);

    return NextResponse.json({
      mode: 'paper',
      liveTradingEnabled: false,
      config,
      configAudit,
      account,
      decisions,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
