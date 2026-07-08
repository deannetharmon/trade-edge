// app/api/wheel-candidates/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `wheel-candidates:${userId}`;
}

export type WheelStage = 'hunting-csp' | 'own-writing-cc';

// One row on the Wheel Candidates tab. deltaOverride/dteOverride/manualPick
// are optional -- when absent, the tab falls back to wheel-config's global
// defaults and auto-search (see lib/wheel/chainSearch.ts).
export interface WheelCandidate {
  symbol: string;
  sector?: string;
  wheelStage: WheelStage;
  costBasis?: number | null; // set once assigned; drives own-writing-cc reference price
  deltaOverride?: { min: number; max: number } | null;
  dteOverride?: { min: number; max: number } | null;
  manualPick?: { expirationDate: string; strikePrice: number } | null;
  updatedAt: string;
}

type CandidateStore = Record<string, WheelCandidate>; // keyed by symbol

// GET /api/wheel-candidates  ->  { candidates: CandidateStore }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    const candidates: CandidateStore = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ candidates });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/wheel-candidates
// Body: { symbol: string; candidate: Partial<WheelCandidate> }
// Upserts (deep-merges into any existing row for that symbol, or creates a
// new one with wheelStage defaulting to 'hunting-csp').
// Response: { ok: true, candidates: CandidateStore }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const symbol: string | undefined = body?.symbol;
    const patch: Partial<WheelCandidate> = body?.candidate ?? {};
    if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

    const raw = await redis.get(redisKey(userId));
    const store: CandidateStore = raw ? JSON.parse(raw) : {};

    const existing = store[symbol];
    const merged: WheelCandidate = {
      ...existing,
      ...patch,
      symbol,
      wheelStage: patch.wheelStage ?? existing?.wheelStage ?? 'hunting-csp',
      updatedAt: new Date().toISOString(),
    };

    store[symbol] = merged;
    await redis.set(redisKey(userId), JSON.stringify(store));
    return NextResponse.json({ ok: true, candidates: store });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/wheel-candidates?symbol=XYZ  ->  removes one row
// DELETE /api/wheel-candidates              ->  clears all rows for the user
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  const symbol = req.nextUrl.searchParams.get('symbol');

  try {
    if (!symbol) {
      await redis.del(redisKey(userId));
      return NextResponse.json({ ok: true, candidates: {} });
    }

    const raw = await redis.get(redisKey(userId));
    const store: CandidateStore = raw ? JSON.parse(raw) : {};
    delete store[symbol];
    await redis.set(redisKey(userId), JSON.stringify(store));
    return NextResponse.json({ ok: true, candidates: store });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
