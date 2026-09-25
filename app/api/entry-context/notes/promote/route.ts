import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { promotePendingEntryNote } from '@/lib/entry-context/entryNote';
import { readPendingEntryNote, saveEntryNote } from '@/lib/entry-context/entryNoteStore';
import { entrySnapshotOwnerScope } from '@/lib/entry-context/store';
import { readBrokerTransactionsSince } from '@/lib/entry-context/brokerTransactions';
import { getServerBrokerAccessToken, serverBrokerFetch } from '@/lib/tastytrade/server-token';

/** Promotes a pending entry note once the broker confirms the opening fill. Same checks as the entry snapshot promotion. */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    const accountId = typeof body?.accountId === 'string' ? body.accountId : '';
    const brokerOrderId = typeof body?.brokerOrderId === 'string' ? body.brokerOrderId : '';
    if (!accountId || !brokerOrderId) return NextResponse.json({ error: 'accountId and brokerOrderId are required' }, { status: 400 });
    const ownerScope = entrySnapshotOwnerScope(userId, accountId);
    const pending = await readPendingEntryNote(ownerScope, brokerOrderId);
    if (!pending) return NextResponse.json({ error: 'Pending entry note was not found' }, { status: 404 });
    const token = await getServerBrokerAccessToken(userId);
    const accounts = await serverBrokerFetch('/customers/me/accounts', token);
    const ownsAccount = (accounts?.data?.items ?? []).some((item: any) => item?.account?.['account-number'] === accountId);
    if (!ownsAccount) return NextResponse.json({ error: 'Broker account is not available to this user' }, { status: 403 });
    const transactions = await readBrokerTransactionsSince(accountId, pending.submittedAt.slice(0, 10), token);
    const note = promotePendingEntryNote(pending, transactions);
    if (!note) return NextResponse.json({ promoted: false });
    const saved = await saveEntryNote(note, ownerScope);
    return NextResponse.json({ promoted: true, created: saved.created, note: saved.note }, { status: saved.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Promotion failed' }, { status: 400 });
  }
}
