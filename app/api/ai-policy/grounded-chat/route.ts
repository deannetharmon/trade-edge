// app/api/ai-policy/grounded-chat/route.ts
//
// POST: ask a question about a frozen scan snapshot (AI-POLICY-0001B). Only `message` and `priorArtifactIds` carry
// conversation: the server loads prior answers itself, so there is no way to send assistant text. Any other key is
// refused. No policy logic lives here.

import { requireSessionUserId } from '@/lib/ai/requireSession';
import { runAiRoute } from '@/lib/ai-policy/gateway';
import { pickStrict, readBoundedJson, routeResultResponse, unauthorizedResponse, unavailableResponse } from '@/lib/ai-policy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const userId = await requireSessionUserId();
  if (!userId) return unauthorizedResponse();

  const body = await readBoundedJson(request, 20_000);
  const parsed = body.ok ? pickStrict(body.value, ['analysisInputId', 'idempotencyKey', 'message'], ['priorArtifactIds']) : null;
  const prior = parsed?.priorArtifactIds;
  if (
    !parsed || typeof parsed.analysisInputId !== 'string' || typeof parsed.idempotencyKey !== 'string' || typeof parsed.message !== 'string' ||
    (prior !== undefined && (!Array.isArray(prior) || !prior.every((id) => typeof id === 'string')))
  ) {
    return unavailableResponse('INPUT_INVALID');
  }

  return routeResultResponse(
    await runAiRoute({
      route: 'grounded_chat', userId, inputId: parsed.analysisInputId, idempotencyKey: parsed.idempotencyKey, question: parsed.message,
      priorArtifactIds: prior as string[] | undefined, userAction: 'click:grounded_chat',
    }),
  );
}
