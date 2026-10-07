// features/portfolio/positions-workspace/PortfolioSummaryStrip.tsx

// PORTFOLIO-SUMMARY-0001: the P/L summary tiles above Portfolio and Position Analysis (mock:
// https://claude.ai/artifact/GaxxUqLfRSa4zABBsXGmvv). Always the whole portfolio; clicking a tile filters the list below.
// Diane: P/L green/red only, no coloured tile backgrounds; amber only for needs-attention, using-margin and over-limit
// exposure; secondary lines small.

'use client';

import type { PortfolioSummary, SummaryGroupKey, SummaryTile, SummedFigure } from './model/portfolioSummary';

const signedMoney = (v: number) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const money = (v: number) => `$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const tone = (v: number | null) => (v == null ? 'text-white/50' : v >= 0 ? 'text-emerald-400' : 'text-red-400');

function partial(f: SummedFigure): string {
  return f.included < f.of ? ` (${f.included} of ${f.of})` : '';
}

function Figure({ figure, prefix }: { figure: SummedFigure; prefix: string }) {
  if (figure.of === 0) return null;
  return (
    <span>
      <span className="text-white/50">{prefix} </span>
      {figure.value == null ? <span className="text-white/50">Unavailable</span> : <span className={tone(figure.value)}>{signedMoney(figure.value)}</span>}
      {figure.value != null && figure.included < figure.of && <span className="text-white/50">{` partial${partial(figure)}`}</span>}
    </span>
  );
}

function TileBody({ tile, weekSince }: { tile: SummaryTile; weekSince: string | null }) {
  const returnText = tile.returnPct != null && tile.basis ? ` · ${tile.returnPct >= 0 ? '+' : ''}${tile.returnPct}% of ${tile.basis}` : '';
  return (
    <>
      <span className="block text-[10px] uppercase tracking-widest text-white/50">{tile.label}</span>
      <span className={`mt-1 block text-xl font-bold ${tone(tile.pnl.value)}`}>
        {tile.pnl.value == null ? 'Unavailable' : signedMoney(tile.pnl.value)}
      </span>
      <span className="mt-1 block text-[11px] text-white/70">
        {tile.count} {tile.count === 1 ? 'position' : 'positions'}{returnText}
        {tile.pnl.value != null && tile.pnl.included < tile.pnl.of && <span className="text-white/50">{` · ${tile.pnl.included} of ${tile.pnl.of} priced`}</span>}
      </span>
      <span className="mt-0.5 block text-[11px] text-white/50">
        {tile.capital.value != null ? `Capital ${money(tile.capital.value)}${tile.key !== 'TOTAL' && tile.capitalSharePct != null ? ` · ${tile.capitalSharePct}%` : ''}${partial(tile.capital)}` : 'Capital unavailable'}
        {tile.thetaPerDay.value != null && ` · θ ${signedMoney(tile.thetaPerDay.value)}/day`}
      </span>
      <span className="mt-0.5 block text-[11px]" title={`1D: change since the previous close (legs opened today: since their open).${tile.dayMissing.length ? ` Not included: ${tile.dayMissing.map(d => `${d.symbol} (${d.reason})`).join('; ')}.` : ''} 1W: change since the snapshot of ${weekSince ?? 'a week ago'}, same positions only; a position opened since counts from entry; closed positions are in the Trade Log.`}>
        <Figure figure={tile.dayChange} prefix="1D" />
        <span className="text-white/50"> · </span>
        <Figure figure={tile.weekChange} prefix="1W" />
      </span>
      {tile.needsAttention > 0 && <span className="mt-1 block text-[11px] font-semibold text-amber-400">{tile.needsAttention} need attention</span>}
    </>
  );
}

export function PortfolioSummaryStrip({ summary, selected, onSelect, onSelectSymbol }: {
  summary: PortfolioSummary;
  selected: SummaryGroupKey | null;
  onSelect: (group: SummaryGroupKey | null) => void;
  onSelectSymbol?: (symbol: string) => void;
}) {
  const tileClass = (on: boolean) =>
    `min-h-11 rounded-lg border bg-slate-950 p-3 text-left focus:outline-none focus:ring-2 focus:ring-teal-400 ${on ? 'border-teal-400' : 'border-white/15 hover:border-white/30'}`;
  const { cashToDeploy, largest } = summary;
  return (
    <section aria-label="P/L by position type" className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
      <div className={tileClass(selected == null)}>
        <button type="button" aria-pressed={selected == null} onClick={() => onSelect(null)} className="block w-full text-left focus:outline-none">
          <TileBody tile={summary.total} weekSince={summary.weekSince} />
        </button>
        <span className="mt-2 block border-t border-white/10 pt-2 text-[11px]" title="Cash balance minus full short-put collateral, spread max loss and cash held by working opening orders. Margin buying power is not counted.">
          <span className="text-white/50">Cash to deploy (no margin) </span>
          {cashToDeploy.value == null
            ? <span className="text-white/50">Unavailable</span>
            : <span className={`font-bold ${cashToDeploy.usingMargin ? 'text-amber-400' : 'text-white'}`}>{cashToDeploy.usingMargin ? `-${money(cashToDeploy.value)} · using margin` : money(cashToDeploy.value)}</span>}
          {cashToDeploy.excluded > 0 && <span className="text-white/50">{` · ${cashToDeploy.excluded} not cash-securable, excluded`}</span>}
        </span>
        {largest && (
          <button type="button" onClick={() => onSelectSymbol?.(largest.symbol)} title={`Largest single-underlying share of capital. Amber above ${largest.limitPct}%.`}
            className={`mt-1 block text-left text-[11px] focus:outline-none focus:ring-2 focus:ring-teal-400 ${largest.overLimit ? 'font-semibold text-amber-400' : 'text-white/50'}`}>
            Largest: {largest.symbol} · {money(largest.capital)} · {largest.sharePct}% of capital
          </button>
        )}
      </div>
      {summary.groups.map(tile => (
        <button key={tile.key} type="button" aria-pressed={selected === tile.key} onClick={() => onSelect(selected === tile.key ? null : tile.key as SummaryGroupKey)} className={tileClass(selected === tile.key)}>
          <TileBody tile={tile} weekSince={summary.weekSince} />
        </button>
      ))}
    </section>
  );
}
