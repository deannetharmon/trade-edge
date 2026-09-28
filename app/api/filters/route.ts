import Redis from 'ioredis';
import { NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL not configured');
  return new Redis(url);
}

// SEC-0001 S3: this route used a global, non-user-scoped key
// (`filters:${strategy}`) -- not just missing a session check, but missing
// per-user namespacing entirely, unlike every other Redis-backed feature in
// this app (keyed by Google OAuth user id). Dean approved migrating his
// existing saved presets to the new scoped key rather than starting fresh.
// `resolveFiltersKey` performs that migration lazily, once, the first time
// any handler runs for a given strategy after this deploy: if the new
// user-scoped key is empty but the old global key has data, the data is
// copied over and the old key is deleted so there is exactly one live copy
// going forward.
async function resolveFiltersKey(redis: Redis, userId: string, strategy: string): Promise<string> {
  const newKey = `filters:${userId}:${strategy}`;
  const oldKey = `filters:${strategy}`;
  const existingNew = await redis.get(newKey);
  if (existingNew != null) return newKey;
  const legacy = await redis.get(oldKey);
  if (legacy != null) {
    await redis.set(newKey, legacy);
    await redis.del(oldKey);
  }
  return newKey;
}

export async function GET(request: Request) {
  let redis;
  try {
    const userId = await requireSessionUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const strategy = searchParams.get('strategy');
    if (!strategy) return NextResponse.json({ error: 'strategy required' }, { status: 400 });
    redis = getRedis();
    const key = await resolveFiltersKey(redis, userId, strategy);
    const raw = await redis.get(key);
    const filters = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ filters });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    redis?.disconnect();
  }
}

export async function POST(request: Request) {
  let redis;
  try {
    const userId = await requireSessionUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { strategy, name, tickers, bps, bcs, ic, replace } = await request.json();
    if (!strategy || !name) return NextResponse.json({ error: 'strategy and name required' }, { status: 400 });
    redis = getRedis();
    const key = await resolveFiltersKey(redis, userId, strategy);
    const raw = await redis.get(key);
    const existing: Record<string, any> = raw ? JSON.parse(raw) : {};
    if (existing[name] && !replace) {
      return NextResponse.json({ conflict: true, message: `"${name}" already exists` });
    }
    existing[name] = strategy === 'global' ? { bps: bps ?? [], bcs: bcs ?? [], ic: ic ?? [] } : tickers;
    await redis.set(key, JSON.stringify(existing));
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    redis?.disconnect();
  }
}

export async function DELETE(request: Request) {
  let redis;
  try {
    const userId = await requireSessionUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { strategy, name } = await request.json();
    if (!strategy || !name) return NextResponse.json({ error: 'strategy and name required' }, { status: 400 });
    redis = getRedis();
    const key = await resolveFiltersKey(redis, userId, strategy);
    const raw = await redis.get(key);
    const existing: Record<string, any> = raw ? JSON.parse(raw) : {};
    delete existing[name];
    await redis.set(key, JSON.stringify(existing));
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    redis?.disconnect();
  }
}
