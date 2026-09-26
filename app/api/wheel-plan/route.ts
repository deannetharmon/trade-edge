// app/api/wheel-plan/route.ts
//
// WHEEL-SYSTEM-0001 (W1) -- the saved wheel capital plan, one per signed-in user.
//
// GET    -> { plan }            the stored plan, or the defaults (empty overrides, empty list) before any save.
//                               Malformed stored data never breaks this: it is parsed field by field and falls
//                               back to defaults.
// POST   { overrides?, wheelList? }
//                               each part present REPLACES the stored one. Every field is validated and unknown
//                               keys are rejected; a value that breaks the math is a 400, a merely unusual value is saved
//                               (warnings are shown by the tab, never enforced here).
// DELETE -> resets to defaults.
// Nothing here places an order or changes any position or recommendation.

import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';
import { getRedis } from '@/lib/jobs/redis';
import { emptyPlan, parseStoredPlan, validatePlanPatch, type WheelPlan } from '@/lib/wheel/planSchema';

export const dynamic = 'force-dynamic';

const redisKey = (userId: string) => `wheel-plan:${userId}`;

export async function GET(_req: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const raw = await getRedis().get(redisKey(userId));
    return NextResponse.json({ plan: parseStoredPlan(raw) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to read the plan' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be valid JSON.' }, { status: 400 });
  }

  const patch = validatePlanPatch(body);
  if (!patch.ok) return NextResponse.json({ error: 'Invalid plan', errors: patch.errors }, { status: 400 });

  try {
    const redis = getRedis();
    const current = parseStoredPlan(await redis.get(redisKey(userId)));
    const next: WheelPlan = {
      overrides: patch.overrides ?? current.overrides,
      wheelList: patch.wheelList ?? current.wheelList,
      updatedAt: new Date().toISOString(),
    };
    await redis.set(redisKey(userId), JSON.stringify(next));
    return NextResponse.json({ ok: true, plan: next });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to save the plan' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await getRedis().del(redisKey(userId));
    return NextResponse.json({ ok: true, plan: emptyPlan() });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to reset the plan' }, { status: 500 });
  }
}
