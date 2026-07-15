// app/api/decision-reviews/route.ts
//
// PI-0008C: Decision Outcome Tracking V1 -- persistence.
//
// Mirrors app/api/position-intent/route.ts's exact shape: one Redis key per
// user, holding the whole store as a JSON blob, fetched in full and upserted
// in full. No new database or external service -- ioredis + REDIS_URL is
// already this codebase's established pattern for exactly this kind of
// small, per-user, key-value record (position-intent, position-snapshots).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';
import { parseDecisionReviewStore, upsertDecisionReview } from '@/lib/decision-review';
import type { DecisionReview } from '@/lib/decision-review';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `decision-reviews:${userId}`;
}

// GET /api/decision-reviews  ->  { reviews: DecisionReviewStore }
// Uses parseDecisionReviewStore() (not a bare JSON.parse) so a corrupted or
// partially-corrupted blob degrades to an empty/partial store instead of
// this route ever throwing.
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    const reviews = parseDecisionReviewStore(raw);
    return NextResponse.json({ reviews });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/decision-reviews
// Body: { review: DecisionReview }  -- a full upsert, keyed by review.id.
// Used both to create a brand-new review and to save edits to an existing
// one; the caller (features/portfolio/decisionReview/) always sends the
// complete record, never a partial patch, so this route does no merging
// logic of its own beyond keying by id.
// Response: { ok: true }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const review: DecisionReview | undefined = body?.review;
    if (!review?.id || !review.positionId) {
      return NextResponse.json({ error: 'review with id and positionId required' }, { status: 400 });
    }

    const raw = await redis.get(redisKey(userId));
    const store = parseDecisionReviewStore(raw);
    const next = upsertDecisionReview(store, review);

    await redis.set(redisKey(userId), JSON.stringify(next));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
