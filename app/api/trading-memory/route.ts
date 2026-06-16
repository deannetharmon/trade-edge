// app/api/trading-memory/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `trading-memory:${userId}`;
}

// GET /api/trading-memory
// Returns trading memory blob for the authenticated user.
// Response: { memory: TradingMemory | null }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    const memory = raw ? JSON.parse(raw) : null;
    return NextResponse.json({ memory });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/trading-memory
// Writes (replaces) the full trading memory blob.
// Body: { memory: TradingMemory }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const { memory } = await req.json();
    if (memory === undefined) return NextResponse.json({ error: 'memory required' }, { status: 400 });
    await redis.set(redisKey(userId), JSON.stringify(memory));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/trading-memory
// Clears trading memory for the authenticated user.
export async function DELETE(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    await redis.del(redisKey(userId));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
