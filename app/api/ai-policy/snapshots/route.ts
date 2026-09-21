// app/api/ai-policy/snapshots/route.ts
//
// POST: freeze a completed scan session into an immutable server-side analysis input (AI-POLICY-0001B).
// Parses, authenticates, calls the library, serializes. No policy logic lives here.

import { requireSessionUserId } from '@/lib/ai/requireSession';
import { freezeScanSession } from '@/lib/ai-policy/freezeScanSession';
import { freezeResultResponse, oversizeResponse, pickStrict, readBoundedJson, unauthorizedResponse, unavailableResponse } from '@/lib/ai-policy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Below Vercel's request-body limit; a session larger than this is refused rather than truncated. */
const MAX_BODY_BYTES = 2_000_000;

export async function POST(request: Request): Promise<Response> {
  const userId = await requireSessionUserId();
  if (!userId) return unauthorizedResponse();

  const body = await readBoundedJson(request, MAX_BODY_BYTES);
  if (!body.ok) return body.reason === 'TOO_LARGE' ? oversizeResponse() : unavailableResponse('INPUT_INVALID');
  const parsed = pickStrict(body.value, ['kind', 'session', 'idempotencyKey']);
  if (!parsed || parsed.kind !== 'scan_session' || typeof parsed.idempotencyKey !== 'string') return unavailableResponse('INPUT_INVALID');

  return freezeResultResponse(await freezeScanSession({ userId, session: parsed.session, idempotencyKey: parsed.idempotencyKey }));
}
