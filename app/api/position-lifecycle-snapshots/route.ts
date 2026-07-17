// app/api/position-lifecycle-snapshots/route.ts
//
// PI-0009A: Position Snapshot Engine, V1. Persists the event-driven
// lifecycle snapshots produced by lib/position-snapshot/snapshotEngine.ts
// (POSITION_DETECTED / RECOMMENDATION_CHANGE / POSITION_CLOSE). Modeled
// directly on app/api/position-snapshots/route.ts (the existing daily
// Greeks-snapshot store) and app/api/position-entry-snapshots/route.ts --
// same Redis-per-user-JSON-blob pattern, same auth gate, same GET/POST/
// DELETE shape. This is a separate store from both of those: it's event-
// driven rather than daily, and it records Decision Engine output
// (recommendation/confidence/evidence), which neither existing route
// captures.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';
import type { PositionLifecycleSnapshot, PositionSnapshotStore } from '@/lib/position-snapshot';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `position-lifecycle-snapshots:${userId}`;
}

// GET /api/position-lifecycle-snapshots
// Returns the full lifecycle-snapshot store for the authenticated user.
// Response: { snapshots: PositionSnapshotStore }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    const snapshots: PositionSnapshotStore = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ snapshots });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/position-lifecycle-snapshots
// Appends lifecycle snapshots. The caller (planLifecycleSnapshots()) has
// already decided what belongs in this batch, so this route mostly just
// appends -- but it still guards against appending an exact duplicate of
// the last stored snapshot for a key (same event + same recommendation),
// since a fast page re-render/re-fetch could otherwise call this twice
// before the store round-trips back to the client.
// Body: { entries: { positionKey: string; snapshot: PositionLifecycleSnapshot }[] }
// Response: { ok: true, added: number, skipped: number }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const entries: { positionKey: string; snapshot: PositionLifecycleSnapshot }[] = body?.entries ?? [];
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'entries required' }, { status: 400 });
    }

    const raw = await redis.get(redisKey(userId));
    const store: PositionSnapshotStore = raw ? JSON.parse(raw) : {};

    let added = 0;
    let skipped = 0;

    for (const { positionKey, snapshot } of entries) {
      if (!positionKey || !snapshot?.event) { skipped++; continue; }
      const existing = store[positionKey] ?? [];
      const last = existing[existing.length - 1];
      const isDuplicateOfLast = last && last.event === snapshot.event && last.recommendation === snapshot.recommendation;
      if (isDuplicateOfLast) { skipped++; continue; }
      store[positionKey] = [...existing, snapshot];
      added++;
    }

    if (added > 0) {
      await redis.set(redisKey(userId), JSON.stringify(store));
    }

    return NextResponse.json({ ok: true, added, skipped });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/position-lifecycle-snapshots
// Clears all lifecycle-snapshot history for the authenticated user. Mainly
// useful for testing/debugging -- normal use never needs this.
export async function DELETE(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    await redis.del(redisKey(userId));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
