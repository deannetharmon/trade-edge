import { NextRequest, NextResponse } from 'next/server';
import { executeScreenerSearch } from '@/lib/screener/engine';
import { ScreenerParams } from '@/types/screener';
import { fetchOptionChainFromProvider } from '@/lib/screener/provider';
import { evaluatePMCC, scorePMCC } from '@/lib/screener/strategies/pmcc';
import { evaluateCreditSpread, scoreCreditSpread } from '@/lib/screener/strategies/creditSpread';
import { evaluateCoveredCall, scoreCoveredCall } from '@/lib/screener/strategies/coveredCall';
import { evaluateCSP, scoreCSP } from '@/lib/screener/strategies/csp';

export async function POST(
  request: NextRequest,
  { params }: { params: { strategy: string } }
) {
  try {
    const body = await request.json();
    const { symbols, config } = body as { symbols: string[]; config: Partial<ScreenerParams> };

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json({ error: 'A valid array of underlying symbols is required.' }, { status: 400 });
    }

    const defaultParams: ScreenerParams = {
      minVolume: config?.minVolume ?? 10,
      minIVRank: config?.minIVRank ?? 0,
      maxIVRank: config?.maxIVRank ?? 100,
      minDTE: config?.minDTE ?? 0,
      maxDTE: config?.maxDTE ?? 360,
      maxSpreadWidthPct: config?.maxSpreadWidthPct ?? 0.15,
      requireGreeks: config?.requireGreeks ?? true,
    };

    const strategyKey = params.strategy.toLowerCase();

    switch (strategyKey) {
      case 'pmcc': {
        const results = await executeScreenerSearch(
          symbols,
          defaultParams,
          fetchOptionChainFromProvider,
          evaluatePMCC,
          scorePMCC
        );
        return NextResponse.json({ success: true, count: results.length, data: results });
      }

      case 'credit-spread': {
        const results = await executeScreenerSearch(
          symbols,
          defaultParams,
          fetchOptionChainFromProvider,
          evaluateCreditSpread,
          scoreCreditSpread
        );
        return NextResponse.json({ success: true, count: results.length, data: results });
      }

      case 'covered-call': {
        const results = await executeScreenerSearch(
          symbols,
          defaultParams,
          fetchOptionChainFromProvider,
          evaluateCoveredCall,
          scoreCoveredCall
        );
        return NextResponse.json({ success: true, count: results.length, data: results });
      }

      case 'csp':
      case 'cash-secured-put': {
        const results = await executeScreenerSearch(
          symbols,
          defaultParams,
          fetchOptionChainFromProvider,
          evaluateCSP,
          scoreCSP
        );
        return NextResponse.json({ success: true, count: results.length, data: results });
      }

      default:
        return NextResponse.json({ error: `Unsupported strategy type: ${params.strategy}` }, { status: 400 });
    }
  } catch (error) {
    console.error('Screener route error:', error);
    return NextResponse.json({ error: 'Internal server error processing screener request.' }, { status: 500 });
  }
}
