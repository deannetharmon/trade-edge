// app/api/auth/get-credentials/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { encrypt, decrypt } from '@/lib/crypto';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const key = `user:${userId}:tastytrade`;
  const data = await redis.hgetall(key);

  if (!data?.refresh_token || !data?.client_secret) {
    return NextResponse.json({ hasCredentials: false });
  }

  return NextResponse.json({
    hasCredentials: true,
    refreshToken: decrypt(data.refresh_token),
    clientSecret: decrypt(data.client_secret),
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { refreshToken } = await req.json();
  if (!refreshToken) {
    return NextResponse.json({ error: 'Missing refreshToken' }, { status: 400 });
  }

  const userId = (session.user as any).id;
  const key = `user:${userId}:tastytrade`;
  await redis.hset(key, { refresh_token: encrypt(refreshToken) });

  return NextResponse.json({ ok: true });
}
