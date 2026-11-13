// features/portfolio/positions-workspace/PortfolioSummaryStrip.tsx

// PORTFOLIO-SUMMARY-0001: the P/L summary tiles above Portfolio and Position Analysis (mock:
// https://claude.ai/artifact/GaxxUqLfRSa4zABBsXGmvv). Always the whole portfolio; clicking a tile filters the list below.
// Diane: P/L green/red only, no coloured tile backgrounds; amber only for needs-attention, using-margin and over-limit
// exposure; secondary lines small.

'use client';

import type { ReactNode } from 'react';
import type { PortfolioHeadline, PortfolioSummary, SummaryGroupKey, SummaryTile, SummedFigure } from './model/portfolioSummary';

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
        {tile.capital.value != null
          ? <span className="text-[13px] font-bold text-white" data-testid="tile-capital">{`Capital ${money(tile.capital.value)}${tile.key !== 'TOTAL' && tile.capitalSharePct != null ? ` · ${tile.capitalSharePct}%` : ''}${partial(tile.capital)}`}</span>
          : 'Capital unavailable'}
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

const HEADLINE_TILE = 'rounded-lg border border-teal-400/60 bg-slate-950 p-3';
const reserveTone = (t: 'good' | 'watch' | 'bad') => (t === 'bad' ? 'text-red-400' : t === 'watch' ? 'text-amber-400' : 'text-emerald-400');

/** PORT-HEADLINE-0001: Portfolio Value, Cash to deploy and Deployed Capital, with a line showing how they tie together. */
function HeadlineStrip({ headline }: { headline: PortfolioHeadline }) {
  const { bridge } = headline;
  const fundedPct = bridge && headline.deployed != null && bridge.funded > 0 ? Math.round((headline.deployed / bridge.funded) * 100) : null;
  const unavailable = <span className="text-white/50">Unavailable</span>;
  return (
    <section aria-label="Portfolio headline" data-testid="portfolio-headline" className="mb-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <div className={HEADLINE_TILE} title="Net liquidating value of the account: what everything is worth right now, as reported by the broker.">
          <span className="block text-[10px] uppercase tracking-widest text-white/50">Portfolio Value</span>
          <span className="mt-1 block text-2xl font-bold text-white" data-testid="headline-portfolio-value">{headline.portfolioValue == null ? unavailable : money(headline.portfolioValue)}</span>
          <span className="mt-1 block text-[11px] text-white/50">Net liquidating value</span>
        </div>
        <div className={HEADLINE_TILE} title="Cash balance minus the full strike amount of each short put, the full width of each credit spread and cash held by working opening orders. The premium you kept is already in your cash and counts toward that collateral. Margin buying power is not counted. Option Buying Power is the broker's margin-based figure and is shown for comparison only.">
          <span className="block text-[10px] uppercase tracking-widest text-white/50">Cash to deploy</span>
          <span className={`mt-1 block text-2xl font-bold ${headline.usingMargin ? 'text-amber-400' : 'text-white'}`} data-testid="headline-cash-to-deploy">
            {headline.cashToDeploy == null ? unavailable : headline.usingMargin ? `-${money(headline.cashToDeploy)}` : money(headline.cashToDeploy)}
          </span>
          <span className="mt-1 block text-[11px] text-white/50">{headline.usingMargin ? 'Short-put collateral exceeds cash' : 'Cash balance minus full CSP collateral (no margin)'}</span>
          <span className="mt-2 block border-t border-white/10 pt-2 text-[11px] text-white/50">
            Cash balance {headline.cashBalance == null ? 'unavailable' : money(headline.cashBalance)} · Option Buying Power {headline.optionBuyingPower == null ? 'unavailable' : money(headline.optionBuyingPower)} (broker margin figure)
          </span>
        </div>
        <div className={HEADLINE_TILE} title="Capital you have put to work: short-put and spread max risk (collateral less the premium you kept), long options and shares at cost. Can exceed Portfolio Value when open positions are down.">
          <span className="block text-[10px] uppercase tracking-widest text-white/50">Deployed Capital</span>
          <span className="mt-1 block text-2xl font-bold text-white" data-testid="headline-deployed">
            {headline.deployed == null ? unavailable : money(headline.deployed)}
            {headline.deployedPartial && <span className="text-[11px] font-normal text-white/50"> partial</span>}
          </span>
          <span className="mt-1 block text-[11px] text-white/50">
            {fundedPct != null && bridge ? `${fundedPct}% of ${money(bridge.funded)} funded · ` : ''}at cost, puts net of premium kept
          </span>
          {headline.reserve && (
            <span className={`mt-2 block border-t border-white/10 pt-2 text-[11px] ${reserveTone(headline.reserve.tone)}`} data-testid="headline-reserve"
              title="Option Buying Power as a share of Portfolio Value, against your reserve rule (never below 10%, 20-30% preferred).">
              Reserve {Math.round(headline.reserve.pct)}% · {headline.reserve.label}
            </span>
          )}
        </div>
      </div>
      {bridge && (
        <p className="mt-2 rounded-md border border-dashed border-teal-400/50 px-3 py-2 text-[12px] text-white/80" data-testid="headline-bridge">
          How it adds up: Deployed {money(headline.deployed as number)} + Cash to deploy {headline.cashToDeploy != null && headline.cashToDeploy < 0 ? '-' : ''}{money(headline.cashToDeploy as number)} = <b>{money(bridge.funded)} funded</b>.
          {' '}Portfolio Value {money(bridge.portfolioValue)} is {money(bridge.gap)} {bridge.gap >= 0 ? 'below' : 'above'} that: open P&amp;L {signedMoney(bridge.openPnl)}{bridge.other === 0 ? '' : bridge.reconciles ? <>, other (fees, rounding) {signedMoney(-bridge.other)}</> : <>. <span className="text-amber-300" data-testid="bridge-mismatch">Doesn&apos;t reconcile by {money(Math.abs(bridge.other))}.</span></>}{bridge.other === 0 || bridge.reconciles ? '.' : ''}
        </p>
      )}
    </section>
  );
}

export function PortfolioSummaryStrip({ summary, selected, onSelect, onSelectSymbol, onSelectSymbols, afterHeadline }: {
  summary: PortfolioSummary;
  /** Rendered between the headline strip and the strategy tiles (the portfolio Greeks panel). */
  afterHeadline?: ReactNode;
  selected: SummaryGroupKey | null;
  onSelect: (group: SummaryGroupKey | null) => void;
  onSelectSymbol?: (symbol: string) => void;
  onSelectSymbols?: (symbols: string[]) => void;
}) {
  const tileClass = (on: boolean) =>
    `min-h-11 rounded-lg border bg-slate-950 p-3 text-left focus:outline-none focus:ring-2 focus:ring-teal-400 ${on ? 'border-teal-400' : 'border-white/15 hover:border-white/30'}`;
  const { cashToDeploy, largest, leveragedCluster } = summary;
  const tierClass = (tier: 'normal' | 'amber' | 'red') => tier === 'red' ? 'font-semibold text-red-400' : tier === 'amber' ? 'font-semibold text-amber-400' : 'text-white/50';
  return (
    <>
    <HeadlineStrip headline={summary.headline} />
    {afterHeadline}
    <section aria-label="P/L by position type" className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
      <div className={tileClass(selected == null)}>
        <button type="button" aria-pressed={selected == null} onClick={() => onSelect(null)} className="block w-full text-left focus:outline-none">
          <TileBody tile={summary.total} weekSince={summary.weekSince} />
        </button>
        <span className="mt-2 block border-t border-white/10 pt-2 text-[11px]" title="Cash balance minus the full strike amount of each short put, the full width of each credit spread and cash held by working opening orders. The premium you kept is already in your cash and counts toward that collateral. Margin buying power is not counted. A negative figure is an estimate that your cash-secured collateral exceeds cash, not a margin loan reported by the broker.">
          <span className="text-white/50">Cash to deploy (no margin) </span>
          {cashToDeploy.value == null
            ? <span className="text-white/50">Unavailable</span>
            : <span className={`font-bold ${cashToDeploy.usingMargin ? 'text-amber-400' : 'text-white'}`}>{cashToDeploy.usingMargin ? `-${money(cashToDeploy.value)} · short-put collateral exceeds cash` : money(cashToDeploy.value)}</span>}
          {cashToDeploy.excluded > 0 && <span className="text-white/50">{` · ${cashToDeploy.excluded} not cash-securable, excluded`}</span>}
          {(cashToDeploy.premiumUnverified ?? 0) > 0 && <span className="text-white/50" data-testid="cash-premium-unverified">{` · ${cashToDeploy.premiumUnverified} without a verified entry credit, may overstate`}</span>}
        </span>
        {largest && (
          <button type="button" onClick={() => onSelectSymbol?.(largest.symbol)} title={`Largest single-underlying share of capital. Amber from 15%, red from ${largest.limitPct}%.`}
            className={`mt-1 block text-left text-[11px] focus:outline-none focus:ring-2 focus:ring-teal-400 ${tierClass(largest.tier)}`}>
            Largest: {largest.symbol} · {money(largest.capital)} · {largest.sharePct}% of capital
          </button>
        )}
        {leveragedCluster && (
          <button type="button" onClick={() => onSelectSymbols?.(leveragedCluster.symbols)} title={`Leveraged and inverse ETFs together: ${leveragedCluster.symbols.join(', ')}. Share of capital; amber from 15%, red from ${leveragedCluster.limitPct}%.`}
            className={`mt-1 block text-left text-[11px] focus:outline-none focus:ring-2 focus:ring-teal-400 ${tierClass(leveragedCluster.tier)}`} data-testid="leveraged-cluster">
            Leveraged ETFs: {leveragedCluster.symbols.length} {leveragedCluster.symbols.length === 1 ? 'underlying' : 'underlyings'} · {money(leveragedCluster.capital)} · {leveragedCluster.sharePct}% of capital
          </button>
        )}
      </div>
      {summary.groups.map(tile => (
        <button key={tile.key} type="button" aria-pressed={selected === tile.key} onClick={() => onSelect(selected === tile.key ? null : tile.key as SummaryGroupKey)} className={tileClass(selected === tile.key)}>
          <TileBody tile={tile} weekSince={summary.weekSince} />
        </button>
      ))}
    </section>
    </>
  );
}
