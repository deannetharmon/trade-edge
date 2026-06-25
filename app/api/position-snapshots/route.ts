// app/api/position-snapshots/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `position-snapshots:${userId}`;
}

// One snapshot per position per calendar day (YYYY-MM-DD, local to whenever
// the browser captured it — good enough since this is daily-resolution data,
// not intraday).
interface PositionSnapshot {
  date: string;          // YYYY-MM-DD
  dte: number;
  currentValue: number | null;
  pnl: number | null;
  pnlPct: number | null;
  iv: number | null;
  theta: number | null;
  gamma: number | null;
  netDelta: number | null;
  stockPrice: number | null;
}

type SnapshotStore = Record<string, PositionSnapshot[]>; // keyed by position.key

// GET /api/position-snapshots
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

// POST /api/position-snapshots
// Appends today's snapshot for one or more positions, skipping any position
// that already has a snapshot dated today (idempotent against repeated
// Portfolio page loads on the same day).
// Body: { entries: { positionKey: string; snapshot: PositionSnapshot }[] }
// Response: { ok: true, added: number, skipped: number }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const entries: { positionKey: string; snapshot: PositionSnapshot }[] = body?.entries ?? [];
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'entries required' }, { status: 400 });
    }

    const raw = await redis.get(redisKey(userId));
    const store: SnapshotStore = raw ? JSON.parse(raw) : {};

    let added = 0;
    let skipped = 0;

    for (const { positionKey, snapshot } of entries) {
      if (!positionKey || !snapshot?.date) { skipped++; continue; }
      const existing = store[positionKey] ?? [];
      const alreadyHasToday = existing.some(s => s.date === snapshot.date);
      if (alreadyHasToday) { skipped++; continue; }
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

// DELETE /api/position-snapshots
// Clears all snapshot history for the authenticated user. This is the only
// way snapshots are removed — closed positions keep their history
// permanently otherwise.
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
