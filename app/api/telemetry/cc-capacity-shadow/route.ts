import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { CC_CAPACITY_SHADOW_EVENT } from '@/lib/portfolio-snapshot/shadowParity';
import { recordCoveredCallCapacityShadow } from '@/lib/portfolio-snapshot/shadowTelemetryStore';
import { CC_CAPACITY_SHADOW_MAX_BYTES, parseCapacityShadowTelemetry } from '@/lib/portfolio-snapshot/shadowTelemetrySchema';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
  const result = parseCapacityShadowTelemetry(raw);
  if (!result) return NextResponse.json({ error: 'Invalid telemetry payload' }, { status: 400 });

  try {
    await recordCoveredCallCapacityShadow(result);
    console.info(CC_CAPACITY_SHADOW_EVENT, result);
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch {
    return NextResponse.json({ error: 'Telemetry unavailable' }, { status: 503 });
  }
}
