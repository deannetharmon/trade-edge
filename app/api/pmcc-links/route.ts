// app/api/pmcc-links/route.ts
//
// PMCC-0003: persists the PmccLink pairing (LEAP position key, short-call
// position key, opened date, LEAP cost, cumulative premium collected, roll
// count) whenever TradeEdge links a LEAP + short call as a PMCC, or updates
// that pairing after a confirmed roll. Modeled directly on
// app/api/position-stop-policies/route.ts (Redis-backed, one JSON blob per
// user) -- same reasoning: a PmccLink record is TradeEdge's own durable
// state, not derivable from broker data, and must be replaced (not
// appended) every time TradeEdge updates it, keyed by stable identity (see
// lib/portfolio-data/pmccLinkStore.ts's pmccLinkKey).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';
import type { PmccLink } from '@/lib/portfolio-data/types';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `pmcc-links:${userId}`;
}

type PmccLinkStore = Record<string, PmccLink>; // keyed by pmccLinkKey(leapPositionKey)

// GET /api/pmcc-links
// Returns the full PMCC-link store for the authenticated user.
// Response: { links: PmccLinkStore }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    const links: PmccLinkStore = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ links });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/pmcc-links
// Upserts one or more PMCC link records. ALWAYS overwrites any existing
// record for the same key -- used both to create a new pairing and to
// update an existing one (e.g. after a confirmed short-call roll).
// Body: { entries: { key: string; link: PmccLink }[] }
// Response: { ok: true, links: PmccLinkStore, upserted: number }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const entries: { key: string; link: PmccLink }[] = body?.entries ?? [];
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'entries required' }, { status: 400 });
    }

    const raw = await redis.get(redisKey(userId));
    const store: PmccLinkStore = raw ? JSON.parse(raw) : {};

    let upserted = 0;
    for (const { key, link } of entries) {
      if (!key || !link) continue;
      store[key] = link;
      upserted++;
    }

    if (upserted > 0) {
      await redis.set(redisKey(userId), JSON.stringify(store));
    }

    return NextResponse.json({ ok: true, links: store, upserted });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/pmcc-links?key=<pmccLinkKey>
// Removes a single PMCC pairing (e.g. the trader closes out the whole
// structure). Requires the ?key query param -- unlike
// position-stop-policies' bulk DELETE, this is scoped to one pairing at a
// time since PMCC links are a much lower-volume, higher-stakes record.
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  const key = req.nextUrl.searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'key query param required' }, { status: 400 });

  try {
    const raw = await redis.get(redisKey(userId));
    const store: PmccLinkStore = raw ? JSON.parse(raw) : {};
    if (key in store) {
      delete store[key];
      await redis.set(redisKey(userId), JSON.stringify(store));
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
