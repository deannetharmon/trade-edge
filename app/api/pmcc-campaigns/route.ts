import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';
import type { PmccCampaign } from '@/lib/portfolio/pmccCampaign';

const redis = new Redis(process.env.REDIS_URL!);

function redisKey(userId: string) {
  return `pmcc-campaigns:${userId}`;
}

type Store = Record<string, PmccCampaign>;

function validCampaign(value: unknown): value is PmccCampaign {
  if (!value || typeof value !== 'object') return false;
  const campaign = value as Partial<PmccCampaign>;
  return Boolean(
    campaign.id
    && campaign.accountNumber
    && campaign.underlying
    && campaign.anchorLongOccSymbol
    && Array.isArray(campaign.allocations)
    && Array.isArray(campaign.shortCallCycles)
    && typeof campaign.anchorLongQuantity === 'number'
    && campaign.anchorLongQuantity >= 0
  );
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;
  try {
    const raw = await redis.get(redisKey(userId));
    const campaigns: Store = raw ? JSON.parse(raw) : {};
    return NextResponse.json({ campaigns });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;
  try {
    const body = await req.json();
    const incoming: unknown[] = body?.campaigns ?? [];
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return NextResponse.json({ error: 'campaigns required' }, { status: 400 });
    }
    if (!incoming.every(validCampaign)) {
      return NextResponse.json({ error: 'invalid campaign payload' }, { status: 400 });
    }
    const raw = await redis.get(redisKey(userId));
    const store: Store = raw ? JSON.parse(raw) : {};
    for (const campaign of incoming) {
      store[campaign.id] = campaign;
    }
    await redis.set(redisKey(userId), JSON.stringify(store));
    return NextResponse.json({ ok: true, campaigns: store, upserted: incoming.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    const raw = await redis.get(redisKey(userId));
    const store: Store = raw ? JSON.parse(raw) : {};
    if (!(id in store)) return NextResponse.json({ ok: true, campaigns: store, deleted: 0 });
    delete store[id];
    await redis.set(redisKey(userId), JSON.stringify(store));
    return NextResponse.json({ ok: true, campaigns: store, deleted: 1 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
