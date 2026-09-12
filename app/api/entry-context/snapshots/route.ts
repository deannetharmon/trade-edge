import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { entrySnapshotOwnerScope, readEntrySnapshotsForAccount } from '@/lib/entry-context/store';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const accountId = request.nextUrl.searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
  try {
    return NextResponse.json({ snapshots: await readEntrySnapshotsForAccount(accountId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Snapshot read failed' }, { status: 500 });
  }
}
