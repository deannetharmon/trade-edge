// app/api/research-facts/route.ts
//
// RESEARCH-0002: price-structure facts (ATR, key levels, volume ratio, relative strength vs SPY) for the Research page.
// One year of daily bars for the ticker and for SPY, Yahoo server-side. Requires a signed-in session. Good responses are cached
// for five minutes; errors and empty results never are. Facts only: nothing here scores, ranks or recommends.

import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUserId } from '@/lib/ai/requireSession';
import { cachedJson, UpstreamError } from '@/lib/cache/sharedCache';
import { normalizeResearchSymbol, parseResearchBars } from '@/lib/research/yahooChart';
import { buildResearchFacts, type ResearchFacts } from '@/lib/research/researchFacts';

const FACTS_CACHE_TTL_SECONDS = 300;

async function dailyBars(symbol: string) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; options-screener/1.0)', 'Accept': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new UpstreamError(res.status === 404 ? 404 : 502, res.status === 404 ? `No data for ${symbol}` : `Yahoo Finance returned ${res.status}`);
  const bars = parseResearchBars(await res.json());
  if (!bars || bars.length === 0) throw new UpstreamError(404, `No data for ${symbol}`);
  return bars;
}

export async function GET(req: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const symbol = normalizeResearchSymbol(req.nextUrl.searchParams.get('symbol'));
  if (!symbol) return NextResponse.json({ error: 'A valid symbol is required' }, { status: 400 });

  try {
    const body = await cachedJson<ResearchFacts>(`research-facts:${symbol}`, FACTS_CACHE_TTL_SECONDS, async () => {
      const [stock, spy] = await Promise.all([dailyBars(symbol), symbol === 'SPY' ? Promise.resolve(null) : dailyBars('SPY').catch(() => null)]);
      const facts = buildResearchFacts(symbol, stock, spy ?? (symbol === 'SPY' ? stock : []));
      if (!facts) throw new UpstreamError(502, `Could not build facts for ${symbol}`);
      return { value: facts, cacheable: true };
    });
    return NextResponse.json(body);
  } catch (err: any) {
    if (err instanceof UpstreamError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err?.message ?? 'Unable to load facts' }, { status: 500 });
  }
}
