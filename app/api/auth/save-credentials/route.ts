// app/api/auth/save-credentials/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const redis = new Redis(process.env.REDIS_URL!);
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'hex');

export function encrypt(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, encHex] = payload.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

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
