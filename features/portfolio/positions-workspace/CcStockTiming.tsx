'use client';

// features/portfolio/positions-workspace/CcStockTiming.tsx
// CC-PMCC-GUIDANCE-0001 slice A2 -- the stock card says plainly whether a covered call makes sense yet: "NO CALL TO SELL YET"
// with the RSI and cost reasons, and the cost basis and its source (typed > after put premium > broker, same as the scan).

import { resolveCcBasis, normalizeCcBasisSymbol } from '@/lib/ccBasis/ccBasisSettings';
import { ccTimingNote } from '@/lib/scans/ccGuidance';
import { useCcBasisSettings } from '@/features/screener/useCcBasisSettings';
import { useCcAdjustedBasis } from '@/features/screener/useCcAdjustedBasis';
import { CcBasisLine } from '@/features/screener/components/CcBasisLine';

export function CcStockTiming({ symbol, rsi, price, brokerBasis, shares, cutoff }: {
  symbol: string; rsi: number | null | undefined; price: number | null; brokerBasis: number | null; shares: number; cutoff: number;
}) {
  const { settings } = useCcBasisSettings();
  const adjusted = useCcAdjustedBasis(symbol, shares, brokerBasis);
  const sym = normalizeCcBasisSymbol(symbol) ?? symbol;
  const resolved = resolveCcBasis(settings, sym, brokerBasis === null ? null : ({ costBasis: brokerBasis, costBasisComplete: true } as Parameters<typeof resolveCcBasis>[2]), adjusted);
  const note = ccTimingNote({ symbol, rsi, price, basis: resolved.basis, cutoff });
  if (!note.title && resolved.basis === null) return null;
  return (
    <div data-testid={`cc-stock-timing-${symbol}`} className="mt-3 space-y-1 rounded-lg border border-white/10 p-3 text-[13px]">
      {note.title && <p className="font-bold tracking-wide text-amber-300">{note.title}</p>}
      {note.lines.map(l => <p key={l} className="text-white/80">{l}</p>)}
      <CcBasisLine basis={resolved} />
    </div>
  );
}
