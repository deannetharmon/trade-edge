// app/api/position-entry-dates/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';
import { validateEntryDate } from '@/lib/portfolio/entryDate';

// STOCK-RSI-0001 slice B1: the date the user bought (or took assignment of) a held stock, set by the user.
// Same Redis-backed, accountNumber::positionKey-keyed pattern as /api/position-price-alerts. Nothing here is
// estimated from transactions (that is slice B2); a missing date simply means "no entry date".
type EntryDateStore = Record<string, string>;

const redis = new Redis(process.env.REDIS_URL!);
const redisKey = (userId: string) => `position-entry-dates:${userId}`;
const entryKey = (accountNumber: string, positionKey: string) => `${encodeURIComponent(accountNumber)}::${encodeURIComponent(positionKey)}`;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  try {
    const raw = await redis.get(redisKey(userId));
    return NextResponse.json({ entryDates: raw ? JSON.parse(raw) : {} });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load entry dates' }, { status: 500 });
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
    // A null entryDate is how the caller clears the date.
    const clearing = body?.entryDate === null;
    if (!accountNumber || !positionKey) return NextResponse.json({ error: 'Account and position are required' }, { status: 400 });
    if (!clearing) {
      const problem = validateEntryDate(body?.entryDate);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    const raw = await redis.get(redisKey(userId));
    const store: EntryDateStore = raw ? JSON.parse(raw) : {};
    const key = entryKey(accountNumber, positionKey);
    if (clearing) delete store[key]; else store[key] = body.entryDate as string;
    await redis.set(redisKey(userId), JSON.stringify(store));
    return NextResponse.json({ ok: true, key, entryDate: clearing ? null : store[key] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save entry date' }, { status: 500 });
  }
}
