import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';
import { PMCC_HISTORY_RETENTION_DAYS, shouldAppendLifecycleEvent, type PmccHistoryEvent } from '@/lib/scans/pmccHistory';

const RETENTION_SECONDS = PMCC_HISTORY_RETENTION_DAYS * 24 * 60 * 60;
const redisUrl = () => process.env.REDIS_URL || process.env.KV_URL;
const lifecycleKey = (userId: string) => `pmcc-lifecycle-history:${userId}`;
const snapshotIndexKey = (userId: string) => `pmcc-review-snapshot-index:${userId}`;

async function userIdOrResponse() {
  const session = await getServerSession(authOptions);
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function GET(request: NextRequest) {
  const userId = await userIdOrResponse();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = redisUrl();
  if (!url) return NextResponse.json({ error: 'History storage is not configured' }, { status: 503 });
  try {
    const redis = new Redis(url);
    try {
      const [ids, lifecycleRaw] = await Promise.all([redis.lrange(snapshotIndexKey(userId), 0, 499), redis.get(lifecycleKey(userId))]);
      const records = ids.length ? await redis.mget(ids.map(id => `pmcc-review-snapshot:${userId}:${id}`)) : [];
      const snapshots = records.flatMap(value => { try { return value ? [JSON.parse(value)] : []; } catch { return []; } });
      const lifecycleEvents: PmccHistoryEvent[] = lifecycleRaw ? JSON.parse(lifecycleRaw) : [];
      const symbol = request.nextUrl.searchParams.get('symbol')?.toUpperCase();
      const status = request.nextUrl.searchParams.get('status');
      const from = request.nextUrl.searchParams.get('from');
      const to = request.nextUrl.searchParams.get('to');
      const matches = (row: { symbol?: string; status?: string; submittedAt?: string; observedAt?: string }) =>
        (!symbol || row.symbol === symbol) && (!status || row.status === status) && (!from || (row.submittedAt ?? row.observedAt ?? '') >= from) && (!to || (row.submittedAt ?? row.observedAt ?? '') <= `${to}T23:59:59.999Z`);
      return NextResponse.json({ snapshots: snapshots.filter(matches), lifecycleEvents: lifecycleEvents.filter(matches), retentionDays: PMCC_HISTORY_RETENTION_DAYS });
    } finally { redis.disconnect(); }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load PMCC history' }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const userId = await userIdOrResponse();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = redisUrl();
  if (!url) return NextResponse.json({ error: 'History storage is not configured' }, { status: 503 });
  try {
    const body = await request.json();
    if (!body || typeof body.positionKey !== 'string' || typeof body.symbol !== 'string' || typeof body.status !== 'string' || !Array.isArray(body.alerts)) return NextResponse.json({ error: 'Invalid lifecycle event' }, { status: 400 });
    const observedAt = typeof body.observedAt === 'string' ? body.observedAt : new Date().toISOString();
    const redis = new Redis(url);
    try {
      const raw = await redis.get(lifecycleKey(userId));
      const existing: PmccHistoryEvent[] = raw ? JSON.parse(raw) : [];
      const last = [...existing].reverse().find(event => event.positionKey === body.positionKey);
      const candidate = { positionKey: body.positionKey, status: body.status, alerts: body.alerts, observedAt } as PmccHistoryEvent;
      if (!shouldAppendLifecycleEvent(last, candidate)) return NextResponse.json({ ok: true, added: false });
      const event: PmccHistoryEvent = { id: crypto.randomUUID(), kind: 'LIFECYCLE_ALERT', positionKey: body.positionKey, symbol: body.symbol.toUpperCase(), observedAt, status: body.status, alerts: body.alerts, expiresAt: new Date(Date.now() + RETENTION_SECONDS * 1000).toISOString() };
      await redis.set(lifecycleKey(userId), JSON.stringify([...existing, event]), 'EX', RETENTION_SECONDS);
      return NextResponse.json({ ok: true, added: true, id: event.id });
    } finally { redis.disconnect(); }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save lifecycle event' }, { status: 500 }); }
}
