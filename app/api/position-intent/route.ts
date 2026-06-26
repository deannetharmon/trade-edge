mkdir -p app/api/position-intent
cat > app/api/position-intent/route.ts << 'ROUTE_EOF'
// app/api/position-intent/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `position-intent:${userId}`;
}

// Per-position trade intent. This is the reference point the AI analysis uses to
// decide whether assignment is success (acquisition) or failure (income), and to
// weigh hold/close/roll honestly. Auto-defaulted client-side (CSP -> acquisition,
// spreads -> income) and only persisted here when the trader overrides.
export type PositionIntent = 'income' | 'acquisition' | 'neutral';

type IntentStore = Record<string, PositionIntent>; // keyed by position.key

// GET /api/position-intent  ->  { intents: IntentStore }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    const intents: IntentStore = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ intents });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/position-intent
// Body: { positionKey: string; intent: PositionIntent | null }  (null removes override)
// Response: { ok: true }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const positionKey: string | undefined = body?.positionKey;
    const intent: PositionIntent | null = body?.intent ?? null;
    if (!positionKey) {
      return NextResponse.json({ error: 'positionKey required' }, { status: 400 });
    }
    if (intent !== null && !['income', 'acquisition', 'neutral'].includes(intent)) {
      return NextResponse.json({ error: 'invalid intent' }, { status: 400 });
    }

    const raw = await redis.get(redisKey(userId));
    const store: IntentStore = raw ? JSON.parse(raw) : {};

    if (intent === null) {
      delete store[positionKey];
    } else {
      store[positionKey] = intent;
    }

    await redis.set(redisKey(userId), JSON.stringify(store));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/position-intent  ->  clears all overrides for the user
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
ROUTE_EOF
