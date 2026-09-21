// app/api/ai-policy/artifacts/[id]/route.ts
//
// GET: read one rendered artifact for its owner (AI-POLICY-0001B). A missing id and another user's id give the same
// NOT_FOUND. `status` is computed on read: an artifact that is no longer the current one for its subject reads as stale.

import { requireSessionUserId } from '@/lib/ai/requireSession';
import { readArtifactForUser } from '@/lib/ai-policy/artifactRead';
import { artifactReadResponse, unauthorizedResponse } from '@/lib/ai-policy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const userId = await requireSessionUserId();
  if (!userId) return unauthorizedResponse();
  return artifactReadResponse(await readArtifactForUser(userId, params.id));
}
