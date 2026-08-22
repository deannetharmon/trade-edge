import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { CC_CAPACITY_SHADOW_EVENT } from '@/lib/portfolio-snapshot/shadowParity';
import {
  ingestCoveredCallCapacityShadow,
  readCoveredCallCapacityShadowRecent,
} from '@/lib/portfolio-snapshot/shadowTelemetryStore';
import { CC_CAPACITY_SHADOW_MAX_BYTES, parseCapacityShadowTelemetry } from '@/lib/portfolio-snapshot/shadowTelemetrySchema';
import {
  fingerprintCapacityShadowEvent,
  hashCapacityShadowIdentity,
  sanitizeCapacityShadowForStorage,
} from '@/lib/portfolio-snapshot/shadowTelemetryServer';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const requested = Number(new URL(request.url).searchParams.get('limit') ?? '100');
  const limit = Number.isFinite(requested) ? requested : 100;
  try {
    const events = await readCoveredCallCapacityShadowRecent(new Date(), limit);
    return NextResponse.json({ events });
  } catch {
    return NextResponse.json({ error: 'Telemetry unavailable' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = session.user as { id?: unknown; email?: unknown };
  const identity = typeof user.id === 'string' ? user.id : typeof user.email === 'string' ? user.email : null;
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!identity || !secret) return NextResponse.json({ error: 'Telemetry unavailable' }, { status: 503 });

  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > CC_CAPACITY_SHADOW_MAX_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > CC_CAPACITY_SHADOW_MAX_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const receivedAtDate = new Date();
  const receivedAt = receivedAtDate.toISOString();
  const result = parseCapacityShadowTelemetry(raw, receivedAtDate);
  if (!result) return NextResponse.json({ error: 'Invalid telemetry payload' }, { status: 400 });

  try {
    const sanitized = sanitizeCapacityShadowForStorage(result, secret);
    const identityHash = hashCapacityShadowIdentity(identity, secret);
    const eventFingerprint = fingerprintCapacityShadowEvent(sanitized, identityHash, secret);
    const outcome = await ingestCoveredCallCapacityShadow(sanitized, {
      receivedAt,
      identityHash,
      eventFingerprint,
    });
    if (outcome === 'rate-limited') {
      return NextResponse.json({ error: 'Telemetry rate limit exceeded' }, { status: 429 });
    }
    if (outcome === 'duplicate') {
      return NextResponse.json({ accepted: true, duplicate: true }, { status: 202 });
    }
    console.info(CC_CAPACITY_SHADOW_EVENT, { ...sanitized, receivedAt });
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch {
    return NextResponse.json({ error: 'Telemetry unavailable' }, { status: 503 });
  }
}
