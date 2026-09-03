// app/api/auth/clear-credentials/route.ts

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

// AUTH-0001: deletes the stored TastyTrade connection (refresh_token +
// client_secret) without touching the Google/NextAuth session, so the
// user can force a real reconnect (e.g. after account-identity or
// IP-block errors) without being signed out entirely. Same Redis key
// shape as save-credentials/get-credentials/tastytrade-token routes —
// do not diverge from `user:${userId}:tastytrade`.
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const key = `user:${userId}:tastytrade`;
  await redis.del(key);

  return NextResponse.json({ ok: true });
}
