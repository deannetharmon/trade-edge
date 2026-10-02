// app/api/suggested-actions-state/route.ts
//
// SUGGESTED-ACTIONS-0001 slice 2: which dashboard suggested-action cards are currently
// "armed" (shown), so the 100% show / 90% release hysteresis is the same on every device.
// Per user (Google OAuth id), keyed `suggested-actions:<userId>`: { [position.key]: ISO time first shown }.

import Redis from 'ioredis';
import { NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';

const MAX_KEYS = 200;

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL not configured');
  return new Redis(url);
}

function redisKey(userId: string) {
  return `suggested-actions:${userId}`;
}

function isArmedMap(value: unknown): value is Record<string, string> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= MAX_KEYS
    && entries.every(([key, time]) => key.length > 0 && key.length <= 200 && typeof time === 'string' && Number.isFinite(Date.parse(time)));
}

// GET /api/suggested-actions-state  ->  { armed: { [positionKey]: isoTime } }
export async function GET() {
  let redis: Redis | undefined;
  try {
    const userId = await requireSessionUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    redis = getRedis();
    const raw = await redis.get(redisKey(userId));
    const parsed = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ armed: isArmedMap(parsed) ? parsed : {} });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    redis?.disconnect();
  }
}

// POST /api/suggested-actions-state   Body: { armed: { [positionKey]: isoTime } }  (replaces the saved map)
export async function POST(request: Request) {
  let redis: Redis | undefined;
  try {
    const userId = await requireSessionUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json();
    if (!isArmedMap(body?.armed)) return NextResponse.json({ error: 'armed must be a map of position key to ISO time' }, { status: 400 });
    redis = getRedis();
    await redis.set(redisKey(userId), JSON.stringify(body.armed));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    redis?.disconnect();
  }
}
