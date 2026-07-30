// app/api/historical-growth/route.ts

import { NextRequest, NextResponse } from "next/server";

// Fetches historical monthly closes from Yahoo Finance and computes an
// annualized CAGR over the requested lookback window (1-5 years).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker");
  const yearsParam = searchParams.get("years");
  const years = Math.min(5, Math.max(1, parseInt(yearsParam || "3", 10) || 3));

  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      ticker
    )}?range=${years}y&interval=1mo`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Yahoo Finance request failed (${res.status})` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      return NextResponse.json({ error: "No data returned for ticker" }, { status: 404 });
    }

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
      return NextResponse.json({ error: "Insufficient price history for ticker" }, { status: 404 });
    }

    const actualYears = (endTs - startTs) / (365.25 * 24 * 60 * 60);
    if (actualYears <= 0) {
      return NextResponse.json({ error: "Insufficient price history span" }, { status: 404 });
    }

    const cagr = Math.pow(endPrice / startPrice, 1 / actualYears) - 1;

    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      years,
      actualYears: Math.round(actualYears * 100) / 100,
      startPrice,
      endPrice,
      annualGrowthPct: Math.round(cagr * 10000) / 100, // e.g. 12.34 meaning 12.34%/yr
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch historical data" },
      { status: 500 }
    );
  }
}
