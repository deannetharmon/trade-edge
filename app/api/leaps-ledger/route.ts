// app/api/leaps-ledger/route.ts
//
// LEAPS-LEDGER-0001 -- the decision history of a held LEAPS.
//
// GET  ?accountNumber=&longOcc=&limit=  -> { events } newest first: card evaluations, your decisions (orders the broker accepted, opening the
//                                         review) and rule changes. Scoped to the signed-in user.
// POST { accountNumber, longOccSymbol, event: { type, payload }, requestId? }
//                                       -> records what the browser reports: a card evaluation, or "opened the review". Everything else in
//                                         the ledger (orders, rule changes) is written by the server, never accepted from here. Client
//                                         events are marked client-attested, validated field by field, and throttled (see ledger.ts).

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';
import { getRedis } from '@/lib/jobs/redis';
import { isDecisionHistoryEvent, sanitizeClientEvent, shouldRecordEvaluation, shouldRecordOpenedReview } from '@/lib/leaps-position-intelligence/ledger';
import { recordLedgerEvent } from '@/lib/leaps-position-intelligence/ledgerStore';
import { readLedger, type LeapsLedgerEvent } from '@/lib/leaps-position-intelligence/persistence';

const IDENTIFIER = /^[A-Za-z0-9 .\-_]{1,64}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,100}$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const LOOKBACK = 50;

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const accountNumber = request.nextUrl.searchParams.get('accountNumber')?.trim() ?? '';
  const longOccSymbol = request.nextUrl.searchParams.get('longOcc')?.trim() ?? '';
  if (!IDENTIFIER.test(accountNumber) || !IDENTIFIER.test(longOccSymbol)) return NextResponse.json({ error: 'accountNumber and longOcc are required' }, { status: 400 });
  const requested = Number(request.nextUrl.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;
  try {
    const events = await readLedger(getRedis(), { userId, canonicalAccountId: accountNumber, longOccSymbol }, MAX_LIMIT);
    return NextResponse.json({ events: events.filter(isDecisionHistoryEvent).slice(0, limit) });
  } catch {
    return NextResponse.json({ error: 'Unable to load the decision history' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A JSON body is required' }, { status: 400 }); }

  const accountNumber = typeof body?.accountNumber === 'string' ? body.accountNumber.trim() : '';
  const longOccSymbol = typeof body?.longOccSymbol === 'string' ? body.longOccSymbol.trim() : '';
  if (!IDENTIFIER.test(accountNumber) || !IDENTIFIER.test(longOccSymbol)) return NextResponse.json({ error: 'accountNumber and longOccSymbol are required' }, { status: 400 });
  const validation = sanitizeClientEvent(body?.event);
  if (!validation.ok) return NextResponse.json({ error: 'That event cannot be recorded', errors: validation.errors }, { status: 400 });
  const requestId = typeof body?.requestId === 'string' && REQUEST_ID.test(body.requestId) ? body.requestId : randomUUID();

  const identity = { userId, canonicalAccountId: accountNumber, longOccSymbol };
  try {
    const redis = getRedis();
    const nowMs = Date.now();
    const recent = await readLedger(redis, identity, LOOKBACK);
    const { event } = validation;
    if (event.type === 'decision-evaluated') {
      const previous = recent.find(item => item.type === 'decision-evaluated');
      const last = previous ? { at: previous.at, state: String(previous.payload.state), reasonCode: (previous.payload.reasonCode as string | null | undefined) ?? null } : null;
      if (!shouldRecordEvaluation(last, { state: event.payload.state, reasonCode: event.payload.reasonCode }, nowMs)) return NextResponse.json({ ok: true, result: 'skipped' });
    } else {
      const previous = recent.find(item => item.type === 'user-decision' && item.payload.action === 'opened-review');
      if (!shouldRecordOpenedReview(previous?.at ?? null, nowMs)) return NextResponse.json({ ok: true, result: 'skipped' });
    }
    const ledgerEvent: LeapsLedgerEvent = {
      id: randomUUID(), at: new Date(nowMs).toISOString(), policyVersion: 'LEAPS-PI-1.1', type: event.type, actor: 'trader', requestId,
      retention: 'append-only', recovery: 'rebuild-from-ledger', payload: event.payload as unknown as Record<string, unknown>,
    };
    await recordLedgerEvent(redis, identity, ledgerEvent);
    return NextResponse.json({ ok: true, result: 'saved' });
  } catch {
    return NextResponse.json({ error: 'Unable to record the event' }, { status: 500 });
  }
}
