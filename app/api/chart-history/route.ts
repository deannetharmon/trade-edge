// app/api/chart-history/route.ts
//
// WHEEL-SYSTEM-0003 Slice B -- a separate, longer-range daily-close route for the own-history check.
// Deliberately NOT a change to /api/chart (6-month range, no session check, ten existing callers) --
// that route is untouched. This route requires a signed-in session (Ian's ruling, decision 4:
// approved; the existing chart route being open is a separate, pre-existing gap, not fixed here).

import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';

const MIN_YEARS = 1;
const MAX_YEARS = 10;
const DEFAULT_YEARS = 5;

export async function GET(req: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const symbol = req.nextUrl.searchParams.get('symbol');
  if (!symbol) return NextResponse.json({ error: 'symbol param required' }, { status: 400 });

  const yearsParam = req.nextUrl.searchParams.get('years');
  const years = yearsParam == null ? DEFAULT_YEARS : (/^\d+$/.test(yearsParam) ? Number.parseInt(yearsParam, 10) : NaN);
  if (!Number.isInteger(years) || years < MIN_YEARS || years > MAX_YEARS) {
    return NextResponse.json({ error: `years must be a whole number between ${MIN_YEARS} and ${MAX_YEARS}` }, { status: 400 });
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${years}y`;

  try {
    const res = await fetch(url, {
      headers: {
        // Yahoo requires a browser-like User-Agent or it returns 401/429
        'User-Agent': 'Mozilla/5.0 (compatible; options-screener/1.0)',
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Yahoo Finance returned ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return NextResponse.json({ error: 'No data returned' }, { status: 404 });

    const timestamps: number[] = result.timestamp ?? [];
    // Split-adjusted, dividend-UNADJUSTED closes -- the `quote` series, never `adjclose`
    // (Alan's ruling O8 in DECIDE-0001).
    const closesRaw: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

    const closes: { t: number; c: number }[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closesRaw[i];
      if (c != null && Number.isFinite(c)) closes.push({ t: timestamps[i], c });
    }

    return NextResponse.json({ closes });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error fetching chart history' }, { status: 500 });
  }
}
