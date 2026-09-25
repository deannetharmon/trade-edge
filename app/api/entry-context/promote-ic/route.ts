import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { persistPromotedPendingIronCondorEntry } from '@/lib/entry-context/promote';
import { readPendingIronCondorEntry } from '@/lib/entry-context/pendingStore';
import { entrySnapshotOwnerScope } from '@/lib/entry-context/store';
import { readBrokerTransactionsSince } from '@/lib/entry-context/brokerTransactions';
import { getServerBrokerAccessToken, serverBrokerFetch } from '@/lib/tastytrade/server-token';

/** Promotes a pending iron condor entry to an entry snapshot once the broker confirms the fill (previously nothing did). */
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
    const pending = await readPendingIronCondorEntry(ownerScope, brokerOrderId);
    if (!pending) return NextResponse.json({ error: 'Pending entry was not found' }, { status: 404 });
    const token = await getServerBrokerAccessToken(userId);
    const accounts = await serverBrokerFetch('/customers/me/accounts', token);
    const ownsAccount = (accounts?.data?.items ?? []).some((item: any) => item?.account?.['account-number'] === accountId);
    if (!ownsAccount) return NextResponse.json({ error: 'Broker account is not available to this user' }, { status: 403 });
    const transactions = await readBrokerTransactionsSince(accountId, pending.submittedAt.slice(0, 10), token);
    const result = await persistPromotedPendingIronCondorEntry(pending, [], transactions, ownerScope);
    return result == null
      ? NextResponse.json({ promoted: false })
      : NextResponse.json({ promoted: true, created: result.created, snapshot: result.snapshot }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Promotion failed' }, { status: 400 });
  }
}
