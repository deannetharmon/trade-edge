// app/api/portfolio/disagreement-log/route.ts
//
// RECO-UNIFY-0001C: the AI-versus-rules disagreement log, one list per signed-in user in Redis. The browser builds the entry (the facts live in
// the browser) and posts it here; the list rules (one per position per snapshot, 500 cap, 180 days) live in lib/portfolio-facts/disagreementLog.
// No broker tokens or account numbers are stored.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';
import { appendDisagreement, backfillOutcome, isValidEntry, KEEP_DAYS, type DisagreementEntry } from '@/lib/portfolio-facts/disagreementLog';

const redis = new Redis(process.env.REDIS_URL!);
const redisKey = (userId: string) => `reco-disagreements:${userId}`;
const TTL_SECONDS = KEEP_DAYS * 86_400;

async function load(userId: string): Promise<DisagreementEntry[]> {
  const raw = await redis.get(redisKey(userId));
  if (!raw) return [];
  try { const list = JSON.parse(raw); return Array.isArray(list) ? list.filter(isValidEntry) : []; } catch { return []; }
}

// GET -> { entries }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json({ entries: await load((session.user as any).id) }); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}

// POST { entry } -> { ok: true }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    if (!isValidEntry(body?.entry)) return NextResponse.json({ error: 'invalid entry' }, { status: 400 });
    const userId = (session.user as any).id;
    const next = appendDisagreement(await load(userId), body.entry);
    await redis.set(redisKey(userId), JSON.stringify(next), 'EX', TTL_SECONDS);
    return NextResponse.json({ ok: true, count: next.length });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}

// PATCH { positionKey, closedAt, lastSeenPnl } -> { ok: true }: the position closed; fill the outcome on its open entries.
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    if (typeof body?.positionKey !== 'string' || !body.positionKey || typeof body?.closedAt !== 'string' || !Number.isFinite(Date.parse(body.closedAt))) {
      return NextResponse.json({ error: 'positionKey and closedAt required' }, { status: 400 });
    }
    const lastSeenPnl = typeof body.lastSeenPnl === 'number' && Number.isFinite(body.lastSeenPnl) ? body.lastSeenPnl : null;
    const userId = (session.user as any).id;
    const next = backfillOutcome(await load(userId), body.positionKey, { closedAt: body.closedAt, lastSeenPnl });
    await redis.set(redisKey(userId), JSON.stringify(next), 'EX', TTL_SECONDS);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
