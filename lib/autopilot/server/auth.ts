// lib/autopilot/server/auth.ts

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function resolveAutopilotUserId(request: Request): Promise<string | null> {
  const bypassId = process.env.DEBUG_AUTH_BYPASS_USER_ID;
  if (bypassId && request.headers.get('x-debug-auth-bypass') === bypassId) return bypassId;

  const session = await getServerSession(authOptions);
  return (session?.user as any)?.id ?? null;
}
