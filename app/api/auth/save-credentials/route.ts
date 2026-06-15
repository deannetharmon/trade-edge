// app/api/auth/save-credentials/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { refreshToken, clientSecret } = await req.json();
  if (!refreshToken || !clientSecret) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
  }

  const userId = (session.user as any).id;
  const key = `user:${userId}:tastytrade`;

  await redis.hset(key, {
    refresh_token: encrypt(refreshToken),
    client_secret: encrypt(clientSecret),
  });

  return NextResponse.json({ ok: true });
}
