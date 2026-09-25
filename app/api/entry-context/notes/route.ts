import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createPendingEntryNote } from '@/lib/entry-context/entryNote';
import { readEntryNotes, readPendingEntryNotes, savePendingEntryNote } from '@/lib/entry-context/entryNoteStore';
import { entrySnapshotOwnerScope } from '@/lib/entry-context/store';

async function userIdOf(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/** Saves what the screener said at order time for a strategy without an entry snapshot (cash-secured puts). */
export async function POST(request: NextRequest) {
  const userId = await userIdOf();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const entry = createPendingEntryNote(await request.json());
    await savePendingEntryNote(entry, entrySnapshotOwnerScope(userId, entry.accountId));
    return NextResponse.json({ pending: entry }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Entry note save failed' }, { status: 400 });
  }
}

/** ?accountId=...&kind=notes (default) returns promoted notes; kind=pending returns notes still waiting for a fill. */
export async function GET(request: NextRequest) {
  const userId = await userIdOf();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const accountId = request.nextUrl.searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
  const ownerScope = entrySnapshotOwnerScope(userId, accountId);
  try {
    return request.nextUrl.searchParams.get('kind') === 'pending'
      ? NextResponse.json({ pending: await readPendingEntryNotes(ownerScope) })
      : NextResponse.json({ notes: await readEntryNotes(ownerScope) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Entry note read failed' }, { status: 500 });
  }
}
