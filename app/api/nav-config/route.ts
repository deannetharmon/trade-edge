// app/api/nav-config/route.ts
//
// NAV-HIDE-0001: per-user list of hidden application tabs.
// Default is an empty list (everything visible). Same Redis-per-user pattern
// as app/api/wheel-config/route.ts.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';
import { sanitizeHiddenTabs, TabId } from '@/lib/nav/tabs';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `nav-config:${userId}`;
}

interface NavConfig {
  hiddenTabs: TabId[];
  updatedAt: string;
}

function readStored(raw: string | null): NavConfig {
  if (!raw) return { hiddenTabs: [], updatedAt: new Date(0).toISOString() };
  try {
    const parsed = JSON.parse(raw);
    return {
      hiddenTabs: sanitizeHiddenTabs(parsed?.hiddenTabs),
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return { hiddenTabs: [], updatedAt: new Date(0).toISOString() };
  }
}

// GET /api/nav-config  ->  { config: { hiddenTabs, updatedAt } }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    return NextResponse.json({ config: readStored(raw) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/nav-config   Body: { hiddenTabs: TabId[] }
// Replaces the hidden list. Unknown or non-hideable ids are dropped.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const config: NavConfig = {
      hiddenTabs: sanitizeHiddenTabs(body?.hiddenTabs),
      updatedAt: new Date().toISOString(),
    };
    await redis.set(redisKey(userId), JSON.stringify(config));
    return NextResponse.json({ ok: true, config });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/nav-config  ->  show every tab again
export async function DELETE(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    await redis.del(redisKey(userId));
    return NextResponse.json({ ok: true, config: readStored(null) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
