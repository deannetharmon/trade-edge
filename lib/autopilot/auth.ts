// lib/autopilot/auth.ts

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function resolveAutopilotUserId(request: Request): Promise<string | null> {
  const bypassId = process.env.DEBUG_AUTH_BYPASS_USER_ID;
  if (bypassId && request.headers.get('x-debug-auth-bypass') === bypassId) return bypassId;

  const session = await getServerSession(authOptions);
  return (session?.user as any)?.id ?? null;
}

export function isAutopilotCronAuthorized(request: Request): boolean {
  const configuredSecret = process.env.AUTOPILOT_CRON_SECRET;
  if (!configuredSecret) return false;
  const supplied = request.headers.get('x-autopilot-cron-secret') ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return supplied === configuredSecret;
}
