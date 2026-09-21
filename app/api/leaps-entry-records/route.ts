// app/api/leaps-entry-records/route.ts
//
// LEAPS-ENTRY-0001 -- read the entry records (market state when an order was accepted) for one held LEAPS.
//
// GET ?accountNumber=&longOcc=  -> { records: LeapsEntryRecord[] } newest first, scoped to the signed-in user. Records are written only by the
// server after the broker accepts an order (lib/leaps-position-intelligence/entryCapture.ts); there is deliberately no write endpoint.

import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';
import { getRedis } from '@/lib/jobs/redis';
import { readEntryRecords, type EntryRedis } from '@/lib/leaps-position-intelligence/entryRecordsStore';

const IDENTIFIER = /^[A-Za-z0-9 .\-_]{1,64}$/;
const MAX_RETURNED = 50;

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const accountNumber = request.nextUrl.searchParams.get('accountNumber')?.trim() ?? '';
  const longOccSymbol = request.nextUrl.searchParams.get('longOcc')?.trim() ?? '';
  if (!IDENTIFIER.test(accountNumber) || !IDENTIFIER.test(longOccSymbol)) return NextResponse.json({ error: 'accountNumber and longOcc are required' }, { status: 400 });
  try {
    const records = await readEntryRecords(getRedis() as unknown as EntryRedis, { userId, accountNumber, longOccSymbol });
    return NextResponse.json({ records: records.slice(0, MAX_RETURNED) });
  } catch {
    return NextResponse.json({ error: 'Unable to load entry records' }, { status: 500 });
  }
}
