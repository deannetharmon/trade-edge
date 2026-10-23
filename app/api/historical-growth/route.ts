// app/api/historical-growth/route.ts

import { NextRequest, NextResponse } from "next/server";
import { requireSessionUserId } from "@/lib/ai/requireSession";
import { cachedJson, UpstreamError } from "@/lib/cache/sharedCache";

// Fetches historical monthly closes from Yahoo Finance and computes an
// annualized CAGR over the requested lookback window (1-5 years). This is PRICE growth, not
// revenue or earnings growth, and must never stand in for either.
//
// DATA-CACHE-0001: requires a signed-in session (it was an open proxy) and caches a good result for 6 hours in the
// shared cache (monthly bars move slowly). Errors are never cached. Response shapes and error messages are unchanged.

// Not exported: Next.js route files may only export route handlers and config fields.
const GROWTH_CACHE_TTL_SECONDS = 6 * 60 * 60;

export async function GET(req: NextRequest) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker");
  const yearsParam = searchParams.get("years");
  const years = Math.min(5, Math.max(1, parseInt(yearsParam || "3", 10) || 3));

  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  try {
    const body = await cachedJson<{
      ticker: string; years: number; actualYears: number; startPrice: number; endPrice: number; annualGrowthPct: number;
    }>(`hist-growth:${ticker.toUpperCase()}:${years}y`, GROWTH_CACHE_TTL_SECONDS, async () => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        ticker
      )}?range=${years}y&interval=1mo`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      if (!res.ok) throw new UpstreamError(502, `Yahoo Finance request failed (${res.status})`);

      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) throw new UpstreamError(404, "No data returned for ticker");

      const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
      const timestamps: number[] = result.timestamp || [];

      let startPrice: number | null = null;
      let startTs: number | null = null;
      for (let i = 0; i < closes.length; i++) {
        if (closes[i] != null) {
          startPrice = closes[i] as number;
          startTs = timestamps[i];
          break;
        }
      }

      let endPrice: number | null = null;
      let endTs: number | null = null;
      for (let i = closes.length - 1; i >= 0; i--) {
        if (closes[i] != null) {
          endPrice = closes[i] as number;
          endTs = timestamps[i];
          break;
        }
      }

      if (startPrice == null || endPrice == null || startTs == null || endTs == null || startPrice <= 0) {
        throw new UpstreamError(404, "Insufficient price history for ticker");
      }

      const actualYears = (endTs - startTs) / (365.25 * 24 * 60 * 60);
      if (actualYears <= 0) throw new UpstreamError(404, "Insufficient price history span");

      const cagr = Math.pow(endPrice / startPrice, 1 / actualYears) - 1;

      return {
        value: {
          ticker: ticker.toUpperCase(),
          years,
          actualYears: Math.round(actualYears * 100) / 100,
          startPrice,
          endPrice,
          annualGrowthPct: Math.round(cagr * 10000) / 100, // e.g. 12.34 meaning 12.34%/yr
        },
        cacheable: true,
      };
    });
    return NextResponse.json(body);
  } catch (err: any) {
    if (err instanceof UpstreamError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err?.message || "Failed to fetch historical data" },
      { status: 500 }
    );
  }
}
