import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';

const redis = new Redis(process.env.REDIS_URL!);
const storeKey = (name: string, userId: string) => `${name}:${userId}`;
const key = (accountNumber: string, positionKey: string) => `${encodeURIComponent(accountNumber)}::${encodeURIComponent(positionKey)}`;

// Promotes trader-authored context only after the client has matched an exact
// filled position. Copy before delete so a failed write never loses context.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const accountNumber = typeof body?.accountNumber === 'string' ? body.accountNumber.trim() : '';
  const fromPositionKey = typeof body?.fromPositionKey === 'string' ? body.fromPositionKey.trim() : '';
  const toPositionKey = typeof body?.toPositionKey === 'string' ? body.toPositionKey.trim() : '';
  if (!accountNumber || !fromPositionKey || !toPositionKey || !fromPositionKey.startsWith('pending::')) return NextResponse.json({ error: 'Invalid promotion identity' }, { status: 400 });
  const userId = (session.user as { id: string }).id;
  try {
    const from = key(accountNumber, fromPositionKey), to = key(accountNumber, toPositionKey);
    for (const name of ['position-notes', 'position-price-alerts']) {
      const redisStoreKey = storeKey(name, userId);
      const store = JSON.parse((await redis.get(redisStoreKey)) ?? '{}') as Record<string, unknown>;
      if (store[from] !== undefined && store[to] === undefined) store[to] = store[from];
      delete store[from];
      await redis.set(redisStoreKey, JSON.stringify(store));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Promotion failed' }, { status: 500 });
  }
}
