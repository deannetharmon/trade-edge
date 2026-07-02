// app/api/balance-history/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `balance-history:${userId}`;
}

// One entry per calendar day (YYYY-MM-DD, from TastyTrade's snapshot-date).
interface BalanceDay {
  date: string;             // YYYY-MM-DD
  netLiquidatingValue: number;
  cashBalance: number;
  netOptionsValue: number;  // long-derivative-value - short-derivative-value
}

type HistoryStore = BalanceDay[]; // sorted ascending by date, deduped by date

// GET /api/balance-history  ->  { history: HistoryStore }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    const history: HistoryStore = raw ? JSON.parse(raw) : [];
    return NextResponse.json({ history });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/balance-history
// Upserts one or more days at once. Any date already stored is left
// untouched (TastyTrade's snapshot for a given closed day doesn't change,
// so first-write-wins is correct and avoids clobbering with a partial/zero
// snapshot on a retry).
// Body: { days: BalanceDay[] }
// Response: { ok: true, added: number, skipped: number, history: HistoryStore }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const days: BalanceDay[] = body?.days ?? [];
    if (!Array.isArray(days) || days.length === 0) {
      return NextResponse.json({ error: 'days required' }, { status: 400 });
    }

    const raw = await redis.get(redisKey(userId));
    const existing: HistoryStore = raw ? JSON.parse(raw) : [];
    const byDate = new Map(existing.map(d => [d.date, d]));

    let added = 0;
    let skipped = 0;

    for (const day of days) {
      if (!day?.date) { skipped++; continue; }
      if (byDate.has(day.date)) { skipped++; continue; }
      byDate.set(day.date, day);
      added++;
    }

    const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

    if (added > 0) {
      await redis.set(redisKey(userId), JSON.stringify(merged));
    }

    return NextResponse.json({ ok: true, added, skipped, history: merged });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
