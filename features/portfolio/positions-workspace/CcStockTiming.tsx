'use client';

// features/portfolio/positions-workspace/CcStockTiming.tsx
// CC-PMCC-GUIDANCE-0001 slice A2 -- the stock card says plainly whether a covered call makes sense yet: "NO CALL YET"
// with the RSI and cost reasons, and the cost basis and its source (typed > after put premium > broker, same as the scan).

import { resolveCcBasis, normalizeCcBasisSymbol } from '@/lib/ccBasis/ccBasisSettings';
import { ccTimingNote } from '@/lib/scans/ccGuidance';
import { useCcBasisSettings } from '@/features/screener/useCcBasisSettings';
import { useCcAdjustedBasis } from '@/features/screener/useCcAdjustedBasis';
import { ccBasisText } from '@/features/screener/components/CcBasisLine';

export function CcStockTiming({ symbol, rsi, price, brokerBasis, shares, cutoff }: {
  symbol: string; rsi: number | null | undefined; price: number | null; brokerBasis: number | null; shares: number; cutoff: number;
}) {
  const { settings } = useCcBasisSettings();
  const adjusted = useCcAdjustedBasis(symbol, shares, brokerBasis);
  const sym = normalizeCcBasisSymbol(symbol) ?? symbol;
  const resolved = resolveCcBasis(settings, sym, brokerBasis === null ? null : ({ costBasis: brokerBasis, costBasisComplete: true } as Parameters<typeof resolveCcBasis>[2]), adjusted);
  const note = ccTimingNote({ symbol, rsi, price, basis: resolved.basis, cutoff });
  if (!note.title && resolved.basis === null) return null;
  const rsiShown = typeof rsi === 'number';
  const below = note.lines.find(l => /below cost/.test(l));
  // With an RSI showing, the Calls chip already says wait and the cost tiles and "Calls use" line carry the basis, so the card
  // keeps only the stopper: price below cost, in red. With no RSI the full line stays, because nothing else says calls are on hold.
  if (rsiShown) {
    if (resolved.basis === null) return <li data-testid={`cc-stock-timing-${symbol}`} className="text-[11px] font-bold text-red-400">{ccBasisText(resolved)}</li>;
    if (!below) return null;
    return <li data-testid={`cc-stock-timing-${symbol}`} className="text-[11px] font-bold text-red-400"><span data-testid={`cc-stock-below-cost-${symbol}`}>{below.replace(/^Price is /, '').replace(/\.$/, '')}</span></li>;
  }
  return (
    <li data-testid={`cc-stock-timing-${symbol}`} className="min-w-[16rem] flex-1 text-[11px] leading-snug text-white/70">
      {note.title && <><b className="font-bold tracking-wide text-amber-300">{note.title}</b>{' · '}</>}
      {note.lines.map(l => <span key={l} className={/below cost/.test(l) ? 'font-bold text-red-400' : undefined}>{l.replace(/\.$/, '')}{' · '}</span>)}
      <span>{ccBasisText(resolved)}</span>
    </li>
  );
}
