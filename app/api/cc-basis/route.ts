// app/api/cc-basis/route.ts
//
// CC-WHEEL-0001 S2a: per-user typed cost basis and "allow strikes below my basis" opt-in for covered calls.
// Same Redis-per-user pattern as app/api/nav-config/route.ts. POST replaces the whole settings object.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';
import { sanitizeCcBasisSettings, type CcBasisSettings } from '@/lib/ccBasis/ccBasisSettings';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `cc-basis:${userId}`;
}

interface StoredCcBasis {
  settings: CcBasisSettings;
  updatedAt: string;
}

function readStored(raw: string | null): StoredCcBasis {
  const empty: StoredCcBasis = { settings: {}, updatedAt: new Date(0).toISOString() };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    return {
      settings: sanitizeCcBasisSettings(parsed?.settings),
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : empty.updatedAt,
    };
  } catch {
    return empty;
  }
}

// GET /api/cc-basis  ->  { config: { settings, updatedAt } }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    return NextResponse.json({ config: readStored(raw) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/cc-basis   Body: { settings: { SYMBOL: { basis: number | null, allowBelowBasis: boolean } } }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const config: StoredCcBasis = {
      settings: sanitizeCcBasisSettings(body?.settings),
      updatedAt: new Date().toISOString(),
    };
    await redis.set(redisKey(userId), JSON.stringify(config));
    return NextResponse.json({ ok: true, config });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/cc-basis  ->  clears every typed basis and opt-in
export async function DELETE(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    await redis.del(redisKey(userId));
    return NextResponse.json({ ok: true, config: readStored(null) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
