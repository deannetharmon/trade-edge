'use client';

import type { PortfolioSnapshot } from '@/lib/portfolio-snapshot/types';
import { buildSnapshotCapacityReport } from '@/lib/portfolio-snapshot/capacity';
import { THEMES, type Theme } from '@/lib/theme';
import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
import { ccRsiChip } from '@/lib/scans/ccRsiChip';
import type { StockRsi } from '@/lib/portfolio/stockRsi';
import { useCcRsiCutoff } from '@/features/screener/useCcRsiCutoff';
import { useHoldingRsi } from './useHoldingRsi';

export function isEquityDisplayEnabled(value = process.env.NEXT_PUBLIC_LCC_0001A_EQUITY_DISPLAY_ENABLED): boolean {
  return value === 'true';
}

export const LCC_0001A_EQUITY_DISPLAY_ENABLED = isEquityDisplayEnabled();

export type PositionsWorkspaceState = 'loading' | 'legacy-empty' | 'empty' | 'workspace';

export function resolvePositionsWorkspaceState(input: {
  equityDisplayEnabled: boolean;
  loading: boolean;
  snapshot: PortfolioSnapshot | null;
  optionCount: number;
  pendingOrderCount: number;
}): PositionsWorkspaceState {
  const hasLegacyData = input.optionCount > 0 || input.pendingOrderCount > 0;
  if (input.loading && !input.snapshot && !hasLegacyData) return 'loading';
  if (!input.equityDisplayEnabled) return hasLegacyData ? 'workspace' : 'legacy-empty';
  if (!input.snapshot) return 'workspace';
  const provenEmpty = input.snapshot.dataQuality.status === 'ok' && input.snapshot.equities.length === 0 && !hasLegacyData;
  return provenEmpty ? 'empty' : 'workspace';
}

function money(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Unavailable';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function isValidTimestamp(value: string | null): value is string {
  return value !== null && Number.isFinite(new Date(value).getTime());
}

function observedLabel(value: string | null): string {
  if (!value) return 'Timestamp unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Timestamp unavailable' : `Snapshot observed ${date.toLocaleString()}`;
}

function quoteAsOfLabel(value: string | null): string {
  if (!isValidTimestamp(value)) return 'Quote timestamp unavailable';
  return `Quote as of ${new Date(value).toLocaleString()}`;
}

// STOCK-RSI-0001: the basis -> price movement caption. Neutral text (Unrealized P/L carries the color). Never guessed:
// an incomplete basis says so, and a missing price falls back to the average basis alone.
function priceCaption(holding: EquityHolding): string {
  if (!holding.basisComplete || holding.basis == null || !(holding.basis > 0)) return 'Basis unavailable';
  if (holding.currentPrice == null || !Number.isFinite(holding.currentPrice)) return `Avg basis ${money(holding.basis)}`;
  const pct = ((holding.currentPrice - holding.basis) / holding.basis) * 100;
  if (Math.abs(pct) < 0.05) return '0.0% since you bought';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}% since you bought`;
}

const RSI_ARROW = { up: { glyph: '▲', label: 'rising' }, down: { glyph: '▼', label: 'falling' }, flat: { glyph: '–', label: 'flat' } } as const;
const RSI_CHIP_TONE = {
  ready: 'bg-emerald-500/15 text-emerald-400',
  recovery: 'bg-sky-500/15 text-sky-400',
  wait: 'bg-amber-500/15 text-amber-400',
} as const;

// STOCK-RSI-0001 slice A. Display only: the number is not colored (the chip is the only signal) and nothing here
// changes a verdict, a score or an order gate. Short stock has no covered-call timing, so it shows RSI without a chip.
function HoldingRsiTile({ holding, rsi, cutoff, th }: {
  holding: EquityHolding;
  rsi: StockRsi | null | undefined;
  cutoff: number;
  th: typeof THEMES[Theme];
}) {
  const chip = rsi && holding.direction === 'Long'
    ? ccRsiChip({ rsi: rsi.rsi, price: holding.currentPrice, costBasis: holding.basisComplete ? holding.basis : null, cutoff })
    : null;
  const arrow = rsi ? RSI_ARROW[rsi.direction] : null;
  return (
    <div data-testid={`equity-rsi-${holding.symbol}-${holding.direction}`} className={`border-l pl-3 ${th.border}`}>
      <dt className={`text-[9px] uppercase tracking-wider ${th.textFaint}`}>RSI (14d)</dt>
      <dd className={`mt-1 flex items-baseline gap-1.5 text-sm ${th.text}`}>
        <span className="font-bold">{rsi ? Math.round(rsi.rsi) : '—'}</span>
        {arrow && <span className={`text-[10px] ${th.textFaint}`} aria-label={arrow.label}>{arrow.glyph}</span>}
        {chip && <span title={chip.reason} className={`rounded px-1.5 py-px text-[10px] font-bold ${RSI_CHIP_TONE[chip.state]}`}>Calls: {chip.label}</span>}
      </dd>
    </div>
  );
}

export function EquityHoldingsSection({ snapshot, th }: {
  snapshot: PortfolioSnapshot | null;
  th: typeof THEMES[Theme];
}) {
  const rsiBySymbol = useHoldingRsi(snapshot ? snapshot.equities.map(h => h.symbol) : []);
  const [ccRsiCutoff] = useCcRsiCutoff();
  if (!snapshot) {
    return (
      <section aria-label="Equity Holdings" className="space-y-2">
        <p className={`text-[10px] ${th.textFaint} tracking-widest font-bold uppercase`}>Equity Holdings — Data unavailable</p>
        <div role="status" className={`rounded-lg border ${th.border} ${th.card} p-4 text-xs text-amber-400`}>
          Stock holdings are unavailable until the unified portfolio snapshot is enabled and refreshed.
        </div>
      </section>
    );
  }

  const capacity = buildSnapshotCapacityReport(snapshot);
  const isLastKnown = snapshot.freshness === 'last-known';

  return (
    <section aria-label="Equity Holdings" className="space-y-3">
      <div className="flex items-center justify-between">
        <p className={`text-[10px] ${th.textFaint} tracking-widest font-bold uppercase`}>
          Equity Holdings — {snapshot.equities.length}
        </p>
        <p className={`text-[10px] ${isLastKnown ? 'text-amber-400' : th.textFaint}`}>
          {isLastKnown ? `Last known holdings · ${observedLabel(snapshot.lastSuccessfulAsOf)}` : observedLabel(snapshot.asOf)}
        </p>
      </div>

      {snapshot.dataQuality.status === 'unavailable' && (
        <div role="status" className="rounded border border-amber-600/60 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          {snapshot.dataQuality.unavailableReason ?? 'Coverage-dependent data is unavailable.'} Holdings remain visible; capacity actions are disabled.
        </div>
      )}

      {snapshot.equities.length === 0 ? (
        <div className={`rounded-lg border ${th.border} ${th.card} p-4 text-xs ${th.textFaint}`}>No stock holdings found.</div>
      ) : snapshot.equities.map(holding => {
        const hasFinitePrice = holding.currentPrice != null && Number.isFinite(holding.currentPrice);
        const economicsCurrent = hasFinitePrice
          && holding.staleQuote === false
          && isValidTimestamp(holding.quoteAsOf)
          && snapshot.freshness === 'current';
        const referencePrice = hasFinitePrice && !economicsCurrent;
        const pnlTone = holding.unrealizedPnl == null ? th.textFaint : holding.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400';
        const symbolCapacity = capacity.status === 'ok' ? capacity.bySymbol[holding.symbol] : null;
        return (
          <article key={`${holding.accountNumber}:${holding.symbol}:${holding.direction}`} data-testid={`equity-holding-${holding.symbol}-${holding.direction}`} className={`rounded-lg border ${th.border} ${th.card} p-4`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`font-bold ${th.text}`}>{holding.symbol}</span>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${holding.direction === 'Short' ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                    {holding.direction} Stock
                  </span>
                  {!holding.basisComplete && <span className="text-[10px] text-amber-400">Basis incomplete</span>}
                </div>
                <p className={`mt-1 text-[10px] ${th.textFaint}`}>{holding.quantity.toLocaleString()} shares · {holding.direction === 'Short' ? 'No covered-call capacity' : 'Stock-only holding'}</p>
              </div>
              <p className={`text-[10px] ${!economicsCurrent ? 'text-amber-400' : th.textFaint}`}>
                {!economicsCurrent ? (referencePrice ? 'Reference price · timestamp unavailable' : 'Pricing unavailable') : quoteAsOfLabel(holding.quoteAsOf)}
              </p>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div>
                <dt className={`text-[9px] uppercase tracking-wider ${th.textFaint}`}>{economicsCurrent ? 'Current price' : referencePrice ? 'Reference price' : 'Current price'}</dt>
                <dd className={`mt-1 text-sm ${th.text}`} title="Average basis to current price">
                  {holding.currentPrice == null ? 'Unavailable' : (
                    <>
                      {holding.basisComplete && holding.basis != null && (
                        <><span className={th.textFaint}>{money(holding.basis)}</span><span className={`mx-1 text-[10px] ${th.textFaint}`} aria-label="to">→</span></>
                      )}
                      <span className="font-bold">{money(holding.currentPrice)}</span>
                    </>
                  )}
                </dd>
                <p className={`mt-0.5 text-[10px] ${th.textFaint}`}>{priceCaption(holding)}</p>
              </div>
              <div><dt className={`text-[9px] uppercase tracking-wider ${th.textFaint}`}>Market value</dt><dd className={`mt-1 text-sm ${th.text}`}>{economicsCurrent ? money(holding.marketValue) : 'Unavailable'}</dd></div>
              <div><dt className={`text-[9px] uppercase tracking-wider ${th.textFaint}`}>Unrealized P/L</dt><dd className={`mt-1 text-sm ${economicsCurrent ? pnlTone : th.textFaint}`}>{economicsCurrent ? money(holding.unrealizedPnl) : 'Unavailable'}</dd></div>
              <div><dt className={`text-[9px] uppercase tracking-wider ${th.textFaint}`}>Call capacity</dt><dd className={`mt-1 text-sm ${th.text}`}>{holding.direction === 'Short' ? '0 contracts' : symbolCapacity ? `${symbolCapacity.availableCoveredContracts} contracts` : 'Unavailable'}</dd></div>
              <HoldingRsiTile holding={holding} rsi={rsiBySymbol[holding.symbol.trim().toUpperCase()]} cutoff={ccRsiCutoff} th={th} />
            </dl>
          </article>
        );
      })}
    </section>
  );
}
