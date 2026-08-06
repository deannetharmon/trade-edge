// app/api/position-stop-policies/route.ts
//
// TE-0002 corrective round: persists the canonical StopLossPolicy provenance
// (anchor basis, anchor value, multiple, source, creation time, broker order
// id) whenever TradeEdge creates or replaces a stop order. Modeled directly
// on app/api/position-entry-snapshots/route.ts (Redis-backed, one JSON blob
// per user), with one key difference: entry snapshots are set once and never
// overwritten, but a stop policy record MUST be replaced every time
// TradeEdge creates or replaces a stop -- the whole point is that the
// record always reflects what TradeEdge most recently set, keyed by stable
// position identity (see lib/portfolio-data/stopPolicyStore.ts's
// positionStopPolicyKey) and cross-checked against the live broker order id
// at read time (lib/portfolio/stopLossPolicy.ts's classifyStopLossPolicy)
// so a stale record can never be misattributed to a different broker order.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';
import type { StopLossPolicy } from '@/lib/portfolio/stopLossPolicy';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `position-stop-policies:${userId}`;
}

type StopPolicyStore = Record<string, StopLossPolicy>; // keyed by positionStopPolicyKey(pos)

// GET /api/position-stop-policies
// Returns the full stop-policy store for the authenticated user.
// Response: { policies: StopPolicyStore }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    const policies: StopPolicyStore = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ policies });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/position-stop-policies
// Upserts stop-policy provenance for one or more positions. UNLIKE entry
// snapshots, this ALWAYS overwrites any existing record for the same key --
// every time TradeEdge creates or replaces a stop order, the new provenance
// must become authoritative.
// Body: { entries: { positionKey: string; policy: StopLossPolicy }[] }
// Response: { ok: true, policies: StopPolicyStore, upserted: number }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const entries: { positionKey: string; policy: StopLossPolicy }[] = body?.entries ?? [];
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'entries required' }, { status: 400 });
    }

    const raw = await redis.get(redisKey(userId));
    const store: StopPolicyStore = raw ? JSON.parse(raw) : {};

    let upserted = 0;
    for (const { positionKey, policy } of entries) {
      if (!positionKey || !policy) continue;
      store[positionKey] = policy;
      upserted++;
    }

    if (upserted > 0) {
      await redis.set(redisKey(userId), JSON.stringify(store));
    }

    return NextResponse.json({ ok: true, policies: store, upserted });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/position-stop-policies
// Clears all stop-policy provenance for the authenticated user (testing/
// debugging only -- does not touch any live broker order).
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
