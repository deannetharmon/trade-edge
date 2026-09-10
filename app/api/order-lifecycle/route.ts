import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listOrderLifecycleEvents, saveOrderLifecycleEvent } from '@/lib/order-lifecycle/store';
import type { OrderLifecycleEvent } from '@/lib/order-lifecycle/types';

function userId(session: any) { return (session?.user as { id?: string } | undefined)?.id; }

export async function GET() {
  const id = userId(await getServerSession(authOptions));
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await listOrderLifecycleEvents(id)); }
  catch (error: any) { return NextResponse.json({ error: error.message ?? 'Lifecycle history unavailable' }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  const id = userId(await getServerSession(authOptions));
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const event = (await req.json())?.event as Partial<OrderLifecycleEvent> | undefined;
    if (!event?.brokerOrderId || !event.accountNumber || !event.symbol || !event.status || !event.kind) return NextResponse.json({ error: 'brokerOrderId, accountNumber, symbol, kind, and status are required' }, { status: 400 });
    const persisted: OrderLifecycleEvent = { ...event, id: event.id ?? crypto.randomUUID(), version: 1, observedAt: event.observedAt ?? new Date().toISOString(), source: event.source ?? 'tradeedge-command' } as OrderLifecycleEvent;
    return NextResponse.json({ store: await saveOrderLifecycleEvent(id, persisted) });
  } catch (error: any) { return NextResponse.json({ error: error.message ?? 'Could not save lifecycle event' }, { status: 500 }); }
}
