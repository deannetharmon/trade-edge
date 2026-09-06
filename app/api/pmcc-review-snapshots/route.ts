import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';

const RETENTION_SECONDS = 548 * 24 * 60 * 60; // 18 calendar months, rounded to 548 days.

type SnapshotInput = {
  symbol: string;
  submittedAt: string;
  brokerOrderId: string;
  policyVersion: string;
  long: { occSymbol: string | null; ask: number | null; quoteAt: string | null };
  short: { occSymbol: string | null; bid: number | null; quoteAt: string | null };
  eventRisk: { status: string; blockers: string[]; cautions: string[]; policyVersion: string };
  occAcknowledgedAt: string | null;
};

function isSnapshot(value: unknown): value is SnapshotInput {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.symbol === 'string' && /^[A-Z.\-]{1,12}$/.test(snapshot.symbol)
    && typeof snapshot.submittedAt === 'string' && typeof snapshot.brokerOrderId === 'string'
    && typeof snapshot.policyVersion === 'string' && snapshot.long != null && snapshot.short != null
    && snapshot.eventRisk != null;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const snapshot = await request.json();
    if (!isSnapshot(snapshot)) return NextResponse.json({ error: 'Invalid PMCC review snapshot' }, { status: 400 });
    const id = crypto.randomUUID();
    const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
    if (!redisUrl) throw new Error('Redis is not configured');
    const redis = new Redis(redisUrl);
    try {
      // One immutable record per submission. Never store broker tokens or account numbers.
      const record = { id, kind: 'SUBMITTED_REVIEW_SNAPSHOT', ...snapshot, expiresAt: new Date(Date.now() + RETENTION_SECONDS * 1000).toISOString() };
      await redis.set(`pmcc-review-snapshot:${userId}:${id}`, JSON.stringify(record), 'EX', RETENTION_SECONDS);
      // Index contains IDs only; the immutable, expiring record remains authoritative.
      await redis.lpush(`pmcc-review-snapshot-index:${userId}`, id);
      await redis.expire(`pmcc-review-snapshot-index:${userId}`, RETENTION_SECONDS);
    } finally {
      redis.disconnect();
    }
    return NextResponse.json({ ok: true, id, retentionDays: 548 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save review snapshot' }, { status: 500 });
  }
}
