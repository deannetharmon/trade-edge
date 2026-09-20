// lib/ai/requireSession.ts
//
// AI-SEC-0001 -- resolves the signed-in user id for OpenAI-backed API routes.
//
// middleware.ts matches page routes only, so /api/* is NOT protected by it;
// every AI route must check the session itself before reading a request body
// or touching the OpenAI key.
//
// Deliberately uses getServerSession(authOptions) directly, the same pattern
// as /api/advisor and /api/leaps-advisor. It does NOT reuse
// resolveAutopilotUserId, which honors a debug auth-bypass header.

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function requireSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}
