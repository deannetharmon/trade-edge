// app/api/pending-order-snapshots/route.ts
//
// PENDING-ENTRY-DECISION-SUPPORT-0001 -- parallel to position-snapshots,
// deliberately not merged into it (a pending order and an open position
// have different identity and lifecycle -- see the ticket). Same Redis-
// backed pattern: GET returns the full store, POST appends new captures.
// Capture itself happens client-side (TastyTrade can't be called server-
// side) and is threshold-gated there, not here -- this route just persists
// whatever the client decided was worth writing.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `pending-order-snapshots:${userId}`;
}

// One entry per meaningful reference-price move (see driftEngine.ts's
// threshold gate) -- not one per page load, to avoid noise.
export interface PendingOrderQuoteSnapshot {
  capturedAt: string; // ISO timestamp
  currentReference: number;
}

type SnapshotStore = Record<string, PendingOrderQuoteSnapshot[]>; // keyed by PendingOrder.id

// GET /api/pending-order-snapshots
// Returns the full snapshot store for the authenticated user.
// Response: { snapshots: SnapshotStore }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    const snapshots: SnapshotStore = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ snapshots });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/pending-order-snapshots
// Appends one snapshot for a pending order. The client has already applied
// the meaningful-move threshold before calling this -- this route trusts
// that gate and just persists.
// Body: { pendingOrderId: string; snapshot: PendingOrderQuoteSnapshot }
// Response: { ok: true }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const pendingOrderId: string | undefined = body?.pendingOrderId;
    const snapshot: PendingOrderQuoteSnapshot | undefined = body?.snapshot;
    if (!pendingOrderId || !snapshot || typeof snapshot.currentReference !== 'number' || !snapshot.capturedAt) {
      return NextResponse.json({ error: 'pendingOrderId and a valid snapshot are required' }, { status: 400 });
    }

    const raw = await redis.get(redisKey(userId));
    const store: SnapshotStore = raw ? JSON.parse(raw) : {};
    store[pendingOrderId] = [...(store[pendingOrderId] ?? []), snapshot];

    await redis.set(redisKey(userId), JSON.stringify(store));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/pending-order-snapshots?pendingOrderId=xyz
// Clears the history for one pending order -- called once it fills or is
// cancelled, since a filled/cancelled order's drift history is no longer
// relevant to anything and would otherwise accumulate indefinitely.
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  const pendingOrderId = req.nextUrl.searchParams.get('pendingOrderId');
  if (!pendingOrderId) return NextResponse.json({ error: 'pendingOrderId required' }, { status: 400 });

  try {
    const raw = await redis.get(redisKey(userId));
    const store: SnapshotStore = raw ? JSON.parse(raw) : {};
    delete store[pendingOrderId];
    await redis.set(redisKey(userId), JSON.stringify(store));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
