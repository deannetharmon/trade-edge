// app/api/active-account/route.ts
//
// ACCOUNT-STICKY-0001: remembers the user's chosen broker account on the
// server so it survives the browser clearing localStorage. The value is only a
// hint: the client validates it against the live TastyTrade account list
// (lib/tastytrade/accountSelection.ts), and a stale id fails closed there.
// Same Redis-per-user pattern as app/api/wheel-config/route.ts.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `active-broker-account:${userId}`;
}

// Broker account numbers are short alphanumeric ids.
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{3,40}$/;

// GET /api/active-account  ->  { accountId: string | null }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    const accountId = typeof parsed?.accountId === 'string' && ACCOUNT_ID_PATTERN.test(parsed.accountId) ? parsed.accountId : null;
    return NextResponse.json({ accountId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/active-account   Body: { accountId: string }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
    if (!ACCOUNT_ID_PATTERN.test(accountId)) {
      return NextResponse.json({ error: 'Invalid accountId' }, { status: 400 });
    }
    await redis.set(redisKey(userId), JSON.stringify({ accountId, updatedAt: new Date().toISOString() }));
    return NextResponse.json({ ok: true, accountId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
