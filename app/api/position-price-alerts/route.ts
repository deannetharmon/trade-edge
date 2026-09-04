// app/api/position-price-alerts/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';

// PRICEALERT-0001: same Redis-backed, accountNumber::positionKey-keyed
// pattern as /api/position-notes -- one more per-position, user-editable
// field, same shape. `direction` is included from day one (not hardcoded
// to 'above') so a future downside/put-side trigger doesn't need a second
// migration later -- today's only real use case (UBER/NFLX's coach-given
// $125 targets) happens to be 'above', but the storage shouldn't assume
// that's the only case that will ever exist.
type Direction = 'above' | 'below';
interface PriceAlert { targetPrice: number; direction: Direction; }
type PriceAlertStore = Record<string, PriceAlert>;

const redis = new Redis(process.env.REDIS_URL!);
const redisKey = (userId: string) => `position-price-alerts:${userId}`;
const alertKey = (accountNumber: string, positionKey: string) => `${encodeURIComponent(accountNumber)}::${encodeURIComponent(positionKey)}`;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  try {
    const raw = await redis.get(redisKey(userId));
    return NextResponse.json({ alerts: raw ? JSON.parse(raw) : {} });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load price alerts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  try {
    const body = await req.json();
    const accountNumber = typeof body?.accountNumber === 'string' ? body.accountNumber.trim() : '';
    const positionKey = typeof body?.positionKey === 'string' ? body.positionKey.trim() : '';
    const targetPrice = typeof body?.targetPrice === 'number' ? body.targetPrice : null;
    const direction: Direction | null = body?.direction === 'above' || body?.direction === 'below' ? body.direction : null;
    // A null targetPrice (rather than a number) is how the caller clears
    // an alert -- same "empty string deletes" convention position-notes
    // already uses, adapted for a numeric field.
    const clearing = body?.targetPrice === null;
    if (!accountNumber || !positionKey) return NextResponse.json({ error: 'Account and position are required' }, { status: 400 });
    if (!clearing && (targetPrice == null || !Number.isFinite(targetPrice) || targetPrice <= 0)) {
      return NextResponse.json({ error: 'Target price must be a positive number' }, { status: 400 });
    }
    if (!clearing && direction == null) return NextResponse.json({ error: 'Direction must be "above" or "below"' }, { status: 400 });

    const raw = await redis.get(redisKey(userId));
    const store: PriceAlertStore = raw ? JSON.parse(raw) : {};
    const key = alertKey(accountNumber, positionKey);
    if (clearing) delete store[key]; else store[key] = { targetPrice: targetPrice!, direction: direction! };
    await redis.set(redisKey(userId), JSON.stringify(store));
    return NextResponse.json({ ok: true, key, alert: clearing ? null : store[key] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save price alert' }, { status: 500 });
  }
}
