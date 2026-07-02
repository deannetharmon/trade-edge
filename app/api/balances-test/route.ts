// app/api/balances-test/route.ts
// TEMPORARY diagnostic route backing /balances test page. Called via fetch()
// from an already-loaded client page, so auth cookies attach normally
// (unlike direct browser navigation to an API route, which does not).

import { NextResponse } from 'next/server';
import { getSessionToken, ttFetch } from '@/lib/tokenStore';

export async function GET() {
  try {
    const token = await getSessionToken();
    const accountsData = await ttFetch('/customers/me/accounts', token);
    const account = accountsData?.data?.items?.find((a: any) => a.account['account-number'] === '5WI51392')
      ?? accountsData?.data?.items?.[0];
    const accountNumber = account?.account?.['account-number'];
    if (!accountNumber) throw new Error('No account found');

    const current = await ttFetch(`/accounts/${accountNumber}/balances`, token);

    const historyPaths = [
      `/accounts/${accountNumber}/balance-snapshots`,
      `/accounts/${accountNumber}/balance-snapshots?time-back=1m`,
      `/accounts/${accountNumber}/net-liquidating-value/history`,
      `/accounts/${accountNumber}/net-liquidating-value/history?time-back=1m`,
    ];

    const historyAttempts: Record<string, any> = {};
    for (const path of historyPaths) {
      try {
        const data = await ttFetch(path, token);
        historyAttempts[path] = { ok: true, sample: data };
      } catch (e: any) {
        historyAttempts[path] = { ok: false, error: e.message };
      }
    }

    return NextResponse.json({ accountNumber, current: current?.data, historyAttempts });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
