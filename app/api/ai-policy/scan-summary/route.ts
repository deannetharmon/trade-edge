// app/api/ai-policy/scan-summary/route.ts
//
// POST: run the scan_summary route on a frozen analysis input (AI-POLICY-0001B). Parses, authenticates, calls
// runAiRoute, serializes. No policy logic lives here.

import { requireSessionUserId } from '@/lib/ai/requireSession';
import { runAiRoute } from '@/lib/ai-policy/gateway';
import { pickStrict, readBoundedJson, routeResultResponse, unauthorizedResponse, unavailableResponse } from '@/lib/ai-policy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const userId = await requireSessionUserId();
  if (!userId) return unauthorizedResponse();

  const body = await readBoundedJson(request, 10_000);
  const parsed = body.ok ? pickStrict(body.value, ['analysisInputId', 'idempotencyKey']) : null;
  if (!parsed || typeof parsed.analysisInputId !== 'string' || typeof parsed.idempotencyKey !== 'string') return unavailableResponse('INPUT_INVALID');

  return routeResultResponse(
    await runAiRoute({ route: 'scan_summary', userId, inputId: parsed.analysisInputId, idempotencyKey: parsed.idempotencyKey, userAction: 'click:scan_summary' }),
  );
}
