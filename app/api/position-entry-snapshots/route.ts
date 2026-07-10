// app/api/position-entry-snapshots/route.ts
//
// Backs Trade Evolution's "entry" baseline (POP/Δ/θ/OTM%/IV/IVR at first
// capture). This route did not previously exist — fetchEntrySnapshots()
// and postEntrySnapshots() in app/portfolio/page.tsx were calling it, but
// every request 404'd, was swallowed by a try/catch, and silently returned
// an empty store. That meant attachEntrySnapshots() found no existing
// snapshot for ANY position on EVERY page load, so it re-derived "entry"
// from today's live values every time — Trade Evolution always showed
// entry == now for every field except DTE (which doesn't depend on this
// store; it's computed directly from the broker's real order-entry date).
//
// Modeled on app/api/position-snapshots/route.ts (the daily-history store,
// which is correctly wired to Redis). Key difference: this store holds ONE
// snapshot per position (its permanent entry baseline), not an array of
// daily snapshots — so POST here upserts-without-overwriting rather than
// appending, matching the "never overwrites an existing key" contract
// already documented in postEntrySnapshots()'s client-side comment.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `position-entry-snapshots:${userId}`;
}

interface EntrySnapshot {
  key: string;
  createdAt: string;
  symbol: string;
  strategy: string;
  expDate: string;
  entryDate: string | null;
  ivAtEntry: number | null;
  ivrAtEntry: number | null;
  popAtEntry: number | null;
  deltaAtEntry: number | null;
  thetaAtEntry: number | null;
  otmAtEntry: number | null;
  dteAtEntry: number | null;
}

type EntrySnapshotStore = Record<string, EntrySnapshot>; // keyed by positionEntrySnapshotKey(pos)

// GET /api/position-entry-snapshots
// Returns the full entry-snapshot store for the authenticated user.
// Response: { snapshots: EntrySnapshotStore }
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    const snapshots: EntrySnapshotStore = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ snapshots });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/position-entry-snapshots
// Upserts entry snapshots for one or more positions, WITHOUT overwriting
// any key that already exists — a position's entry baseline is set once,
// permanently, the first time this route ever sees it. Safe to call
// speculatively on every page load.
// Body: { entries: { positionKey: string; snapshot: EntrySnapshot }[] }
// Response: { ok: true, snapshots: EntrySnapshotStore, added: number, skipped: number }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const entries: { positionKey: string; snapshot: EntrySnapshot }[] = body?.entries ?? [];
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'entries required' }, { status: 400 });
    }

    const raw = await redis.get(redisKey(userId));
    const store: EntrySnapshotStore = raw ? JSON.parse(raw) : {};

    let added = 0;
    let skipped = 0;

    for (const { positionKey, snapshot } of entries) {
      if (!positionKey || !snapshot) { skipped++; continue; }
      if (store[positionKey]) { skipped++; continue; } // never overwrite an existing baseline
      store[positionKey] = snapshot;
      added++;
    }

    if (added > 0) {
      await redis.set(redisKey(userId), JSON.stringify(store));
    }

    // Return the full (post-upsert) store so the client can immediately use
    // real baselines for entries that already existed under a key it just
    // tried to create — mirrors the client's fetchEntrySnapshots() shape.
    return NextResponse.json({ ok: true, snapshots: store, added, skipped });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/position-entry-snapshots
// Clears all entry-snapshot baselines for the authenticated user. Mainly
// useful for testing/debugging — normal use never needs this, since
// baselines are meant to persist permanently once set.
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
