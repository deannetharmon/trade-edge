import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createPendingIronCondorEntry } from '@/lib/entry-context/pending';
import { readPendingIronCondorEntries, readPendingIronCondorEntry, savePendingIronCondorEntry } from '@/lib/entry-context/pendingStore';
import { entrySnapshotOwnerScope } from '@/lib/entry-context/store';

// TRADE-ENTRY-SNAPSHOT-0001 -- Iron Condor's own pending-entry route,
// parallel to /api/entry-context/pending, matching Ian's separate-type
// decision for IC throughout this feature.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const entry = createPendingIronCondorEntry(await request.json());
    await savePendingIronCondorEntry(entry, entrySnapshotOwnerScope(userId, entry.accountId));
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
    ? { pending: await readPendingIronCondorEntry(entrySnapshotOwnerScope(userId, accountId), brokerOrderId) }
    : { pending: await readPendingIronCondorEntries(entrySnapshotOwnerScope(userId, accountId)) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Pending entry read failed' }, { status: 500 }); }
}
