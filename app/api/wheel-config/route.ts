// app/api/wheel-config/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `wheel-config:${userId}`;
}

// Global defaults for the Wheel Candidates tab -- applied to every row unless
// a row has its own override (see wheel-candidates route). Single object per
// user, same pattern as autopilot-config.
export interface WheelConfig {
  defaultDeltaMin: number;
  defaultDeltaMax: number;
  defaultDteMin: number;
  defaultDteMax: number;
  updatedAt: string;
}

const DEFAULT_CONFIG: WheelConfig = {
  defaultDeltaMin: 15,
  defaultDeltaMax: 25,
  defaultDteMin: 30,
  defaultDteMax: 45,
  updatedAt: new Date(0).toISOString(),
};

function mergeConfig(stored: Partial<WheelConfig> | null): WheelConfig {
  if (!stored) return DEFAULT_CONFIG;
  return { ...DEFAULT_CONFIG, ...stored };
}

// GET /api/wheel-config  ->  { config: WheelConfig }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    const stored: Partial<WheelConfig> | null = raw ? JSON.parse(raw) : null;
    return NextResponse.json({ config: mergeConfig(stored) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/wheel-config
// Body: a partial WheelConfig -- only the fields being changed. Deep-merges
// into the stored config (and defaults).
// Response: { ok: true, config: WheelConfig }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const raw = await redis.get(redisKey(userId));
    const stored: Partial<WheelConfig> | null = raw ? JSON.parse(raw) : null;
    const current = mergeConfig(stored);

    const updated: WheelConfig = {
      ...current,
      ...body,
      updatedAt: new Date().toISOString(),
    };

    await redis.set(redisKey(userId), JSON.stringify(updated));
    return NextResponse.json({ ok: true, config: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/wheel-config  ->  resets to defaults for the user
export async function DELETE(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    await redis.del(redisKey(userId));
    return NextResponse.json({ ok: true, config: DEFAULT_CONFIG });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
