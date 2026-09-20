// app/api/leaps-mandate/route.ts
//
// LEAPS-MANDATE-0001 -- read and save the trader's income rules ("mandate") for one held LEAPS.
//
// GET  ?accountNumber=&longOcc=   -> the saved mandate for this user, or null. Keys are scoped by the signed-in user id, so a user can
//                                    only ever read their own.
// POST { underlyingSymbol, longOccSymbol, accountLocator?, mandate, requestId? }
//                                  -> validates the mandate (lib/leaps-position-intelligence/mandate.ts), verifies SERVER-SIDE that the
//                                    signed-in user's broker account really holds this long call (the account used is the one the broker
//                                    confirms, never the one in the request), then saves it atomically with an immutable audit event
//                                    and an idempotency record (lib/leaps-position-intelligence/persistence).
// Nothing here places an order or changes any position.

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';
import { getRedis } from '@/lib/jobs/redis';
import { fetchHeldPmccPositionSnapshot } from '@/lib/leaps-analysis/serverTradeReview';
import { validateMandateInput } from '@/lib/leaps-position-intelligence/mandate';
import { readMandate, saveMandate, type LeapsLedgerEvent } from '@/lib/leaps-position-intelligence/persistence';

const IDENTIFIER = /^[A-Za-z0-9 .\-_]{1,64}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,100}$/;

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const accountNumber = request.nextUrl.searchParams.get('accountNumber')?.trim() ?? '';
  const longOccSymbol = request.nextUrl.searchParams.get('longOcc')?.trim() ?? '';
  if (!IDENTIFIER.test(accountNumber) || !IDENTIFIER.test(longOccSymbol)) return NextResponse.json({ error: 'accountNumber and longOcc are required' }, { status: 400 });
  try {
    const record = await readMandate(getRedis(), { userId, canonicalAccountId: accountNumber, longOccSymbol });
    return NextResponse.json({ mandate: record?.mandate ?? null, updatedAt: record?.updatedAt ?? null });
  } catch {
    return NextResponse.json({ error: 'Unable to load your income rules' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A JSON body is required' }, { status: 400 }); }

  const underlyingSymbol = typeof body?.underlyingSymbol === 'string' ? body.underlyingSymbol.trim().toUpperCase() : '';
  const longOccSymbol = typeof body?.longOccSymbol === 'string' ? body.longOccSymbol.trim() : '';
  const accountLocator = typeof body?.accountLocator === 'string' && body.accountLocator.trim() ? body.accountLocator.trim() : null;
  if (!IDENTIFIER.test(underlyingSymbol) || !IDENTIFIER.test(longOccSymbol)) return NextResponse.json({ error: 'underlyingSymbol and longOccSymbol are required' }, { status: 400 });
  const requestId = typeof body?.requestId === 'string' && REQUEST_ID.test(body.requestId) ? body.requestId : randomUUID();

  const validation = validateMandateInput(body?.mandate);
  if (!validation.ok) return NextResponse.json({ error: 'Your income rules need a fix', errors: validation.errors }, { status: 400 });

  // Authorize server-side: the broker must confirm this account holds this long call.
  let accountNumber: string;
  try {
    const held = await fetchHeldPmccPositionSnapshot(userId, { accountLocator, underlyingSymbol, longOccSymbol });
    if (!held.snapshot.matched || !(held.snapshot.quantity > 0)) return NextResponse.json({ error: 'This contract is not a held long call in your account.' }, { status: 404 });
    accountNumber = held.accountNumber;
  } catch {
    return NextResponse.json({ error: 'Unable to verify the held position right now' }, { status: 502 });
  }

  const now = new Date().toISOString();
  const event: LeapsLedgerEvent = {
    id: randomUUID(), at: now, policyVersion: 'LEAPS-PI-1.1', type: 'mandate-changed', actor: 'trader', requestId,
    retention: 'append-only', recovery: 'rebuild-from-ledger', payload: { mandate: validation.mandate },
  };
  try {
    const result = await saveMandate(getRedis(), { userId, canonicalAccountId: accountNumber, longOccSymbol }, { mandate: validation.mandate, updatedAt: now }, event, requestId);
    return NextResponse.json({ ok: true, result, mandate: validation.mandate, updatedAt: now });
  } catch {
    return NextResponse.json({ error: 'Unable to save your income rules' }, { status: 500 });
  }
}
