// features/screener/components/RsiCallsChips.tsx
//
// STOCK-RSI-0003 -- daily RSI and the "Calls: Ready / Wait / Recovery" chip on scan results that have no candidate row
// to carry them (a disqualified covered-call ticker, the PMCC card). Same chip and the same saved cutoff as the stock
// and LEAP cards. RSI unknown shows a dash. Display only.

'use client';

import { ccRsiChip } from '@/lib/scans/ccRsiChip';
import { useCcRsiCutoff } from '../useCcRsiCutoff';
import { useHoldingRsi } from '@/components/portfolio-data/useHoldingRsi';

const TONE = {
  ready: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  recovery: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  wait: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
} as const;

export function RsiCallsChips({ symbol, rsi, price = null, costBasis = null }: { symbol: string; rsi: number | null | undefined; price?: number | null; costBasis?: number | null }) {
  const [cutoff] = useCcRsiCutoff();
  if (rsi === undefined) return null;
  const chip = rsi === null ? null : ccRsiChip({ rsi, price, costBasis, cutoff });
  return (
    <span data-testid={`rsi-calls-${symbol}`} className="inline-flex items-center gap-1.5 text-[11px] text-white">
      <span>RSI <b>{rsi === null ? '—' : Math.round(rsi)}</b></span>
      {chip && <span title={chip.reason} className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TONE[chip.state]}`}>Calls: {chip.label}</span>}
    </span>
  );
}

/** For cards whose result carries no RSI of its own: reads the shared daily bars. */
export function LiveRsiCallsChips({ symbol }: { symbol: string }) {
  const rsiBySymbol = useHoldingRsi([symbol]);
  const rsi = rsiBySymbol[symbol.trim().toUpperCase()];
  return <RsiCallsChips symbol={symbol} rsi={rsi === undefined ? undefined : rsi ? rsi.rsi : null} />;
}
