import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createPendingCreditSpreadEntry } from '@/lib/entry-context/pending';
import { readPendingCreditSpreadEntries, readPendingCreditSpreadEntry, savePendingCreditSpreadEntry } from '@/lib/entry-context/pendingStore';
import { entrySnapshotOwnerScope } from '@/lib/entry-context/store';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const entry = createPendingCreditSpreadEntry(await request.json());
    await savePendingCreditSpreadEntry(entry, entrySnapshotOwnerScope(userId, entry.accountId));
    return NextResponse.json({ pending: entry }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Pending entry save failed' }, { status: 400 }); }
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const accountId = request.nextUrl.searchParams.get('accountId');
  const brokerOrderId = request.nextUrl.searchParams.get('brokerOrderId');
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
  try { return NextResponse.json(brokerOrderId
    ? { pending: await readPendingCreditSpreadEntry(entrySnapshotOwnerScope(userId, accountId), brokerOrderId) }
    : { pending: await readPendingCreditSpreadEntries(entrySnapshotOwnerScope(userId, accountId)) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Pending entry read failed' }, { status: 500 }); }
}
