// app/api/debug-balance-history/route.ts
// TEMPORARY diagnostic route — delete after confirming the net-liq history
// endpoint shape. Not linked from any UI; safe to leave briefly but should
// not ship long-term since it has no purpose beyond this investigation.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionToken, ttFetch } from '@/lib/tokenStore';

export async function GET(req: NextRequest) {
  try {
    const token = await getSessionToken();
    const accountsData = await ttFetch('/customers/me/accounts', token);
    const account = accountsData?.data?.items?.find((a: any) => a.account['account-number'] === '5WI51392')
      ?? accountsData?.data?.items?.[0];
    const accountNumber = account?.account?.['account-number'];
    if (!accountNumber) throw new Error('No account found');

    const attempts: Record<string, any> = {};

    const paths = [
      `/accounts/${accountNumber}/balance-snapshots`,
      `/accounts/${accountNumber}/balance-snapshots?time-back=1m`,
      `/accounts/${accountNumber}/net-liquidating-value/history`,
      `/accounts/${accountNumber}/net-liquidating-value-history`,
    ];

    for (const path of paths) {
      try {
        const data = await ttFetch(path, token);
        attempts[path] = { ok: true, sample: data };
      } catch (e: any) {
        attempts[path] = { ok: false, error: e.message };
      }
    }

    return NextResponse.json({ accountNumber, attempts }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
