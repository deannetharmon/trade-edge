// app/api/screener/preferences/route.ts
//
// SCREENER-PREFS-0001 -- read and save the signed-in user's scan/result
// filter defaults. GET returns the current record (or all-null/empty if
// nothing is saved yet); POST merges a partial patch into it. Keys are
// scoped by the signed-in user id (lib/screener/scanPreferences.ts), so a
// user can only ever read or write their own.

import { NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';
import { getRedis } from '@/lib/jobs/redis';
import { readScanPreferences, saveScanPreferences } from '@/lib/screener/scanPreferences';
import type { RedisLike } from '@/lib/ai-policy/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const preferences = await readScanPreferences(getRedis() as unknown as RedisLike, userId);
    return NextResponse.json({ preferences });
  } catch {
    return NextResponse.json({ error: 'Unable to load your scan preferences' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'A JSON body is required' }, { status: 400 });
  }
  try {
    const result = await saveScanPreferences(getRedis() as unknown as RedisLike, userId, body);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });
    return NextResponse.json({ preferences: result.preferences });
  } catch {
    return NextResponse.json({ error: 'Unable to save your scan preferences' }, { status: 500 });
  }
}
