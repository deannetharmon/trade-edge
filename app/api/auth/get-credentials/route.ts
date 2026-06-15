// app/api/auth/get-credentials/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../[...nextauth]/route';
import Redis from 'ioredis';
import { decrypt } from '../save-credentials/route';

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

// Called after TastyTrade rotates the refresh token
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

  // Import encrypt inline to avoid circular dependency
  const { createCipheriv, randomBytes } = await import('crypto');
  const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;

  await redis.hset(key, { refresh_token: payload });

  return NextResponse.json({ ok: true });
}
