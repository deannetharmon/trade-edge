// app/api/covered-call-capacity/route.ts
// TE-0007C — Covered Call as a first-class Screener strategy.
//
// Deliberately NOT built on top of /api/positions: that route filters the
// broker payload down to 'Equity Option' / 'Index Option' instrument types
// and discards equity share positions entirely, so it can't answer "how many
// shares of X do I actually own." This route fetches raw account positions
// (unfiltered) plus live/working orders, and delegates all capacity math to
// the pure lib/scans/covered-call-capacity.ts module — no financial logic
// lives in this file.
import { NextResponse } from 'next/server';
import { getSessionToken, ttFetch } from '@/lib/tokenStore';
import { buildCoveredCallCapacityReport } from '@/lib/scans/covered-call-capacity';

export async function GET() {
  try {
    const token = await getSessionToken();

    const accountsData = await ttFetch('/customers/me/accounts', token);
    const accounts = accountsData?.data?.items ?? [];
    if (accounts.length === 0) return NextResponse.json({ error: 'No accounts found' }, { status: 404 });

    const accountNumber = accounts[0]?.account?.['account-number'];
    if (!accountNumber) return NextResponse.json({ error: 'Could not read account number' }, { status: 500 });

    // Raw, UNFILTERED positions — must include both 'Equity' (shares) and
    // 'Equity Option'/'Index Option' (existing short calls) rows. Do not
    // filter this payload the way /api/positions does.
    let rawPositions: any[] | null = null;
    try {
      const positionsData = await ttFetch(`/accounts/${accountNumber}/positions`, token);
      rawPositions = positionsData?.data?.items ?? [];
    } catch {
      rawPositions = null; // holdings unavailable -> report will surface 'unavailable', never a silent zero
    }

    let rawOrders: any[] | null = null;
    try {
      const ordersData = await ttFetch(`/accounts/${accountNumber}/orders/live`, token);
      rawOrders = ordersData?.data?.items ?? [];
    } catch {
      rawOrders = null; // working-order data unavailable -> report will surface 'unavailable'
    }

    const report = buildCoveredCallCapacityReport(rawPositions, rawOrders);

    if (report.status === 'unavailable') {
      return NextResponse.json(
        { status: 'unavailable', error: 'Holdings or working-order data could not be loaded reliably.' },
        { status: 502 },
      );
    }

    // Only symbols with at least gross capacity (>=100 shares) are worth
    // surfacing as "eligible holdings" to the Screener card — a symbol with
    // 40 shares and no calls is correctly zero-available, but isn't a
    // holding the trader needs to see in a covered-call worklist.
    const eligibleHoldings = Object.entries(report.bySymbol)
      .filter(([, capacity]) => capacity.grossCoveredContracts > 0)
      .map(([symbol, capacity]) => ({ symbol, ...capacity }));

    const blockedHoldings = Object.entries(report.bySymbol)
      .filter(([, capacity]) => capacity.grossCoveredContracts > 0 && capacity.availableCoveredContracts === 0)
      .map(([symbol]) => symbol);

    return NextResponse.json({
      status: 'ok',
      accountNumber,
      eligibleHoldings,
      blockedHoldings,
      totalAvailableContracts: eligibleHoldings.reduce((sum, h) => sum + h.availableCoveredContracts, 0),
    });
  } catch (e: any) {
    const status = e.message?.includes('Not authenticated') ? 401 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
