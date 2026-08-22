'use client';

import type { PortfolioSnapshot } from '@/lib/portfolio-snapshot/types';
import { buildSnapshotCapacityReport } from '@/lib/portfolio-snapshot/capacity';
import { THEMES, type Theme } from '@/lib/theme';

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

function observedLabel(value: string | null): string {
  if (!value) return 'Timestamp unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Timestamp unavailable' : `Snapshot observed ${date.toLocaleString()}`;
}

function quoteAsOfLabel(value: string | null): string {
  if (!value) return 'Quote timestamp unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Quote timestamp unavailable' : `Quote as of ${date.toLocaleString()}`;
}

export function EquityHoldingsSection({ snapshot, th }: {
  snapshot: PortfolioSnapshot | null;
  th: typeof THEMES[Theme];
}) {
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
        const economicsCurrent = holding.currentPrice != null && holding.staleQuote === false && holding.quoteAsOf !== null;
        const referencePrice = holding.currentPrice != null && !economicsCurrent;
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
              <div><dt className={`text-[9px] uppercase tracking-wider ${th.textFaint}`}>Average basis</dt><dd className={`mt-1 text-sm ${th.text}`}>{holding.basisComplete ? money(holding.basis) : 'Basis unavailable'}</dd></div>
              <div><dt className={`text-[9px] uppercase tracking-wider ${th.textFaint}`}>{economicsCurrent ? 'Current price' : referencePrice ? 'Reference price' : 'Current price'}</dt><dd className={`mt-1 text-sm ${th.text}`}>{holding.currentPrice == null ? 'Unavailable' : money(holding.currentPrice)}</dd></div>
              <div><dt className={`text-[9px] uppercase tracking-wider ${th.textFaint}`}>Market value</dt><dd className={`mt-1 text-sm ${th.text}`}>{economicsCurrent ? money(holding.marketValue) : 'Unavailable'}</dd></div>
              <div><dt className={`text-[9px] uppercase tracking-wider ${th.textFaint}`}>Unrealized P/L</dt><dd className={`mt-1 text-sm ${economicsCurrent ? pnlTone : th.textFaint}`}>{economicsCurrent ? money(holding.unrealizedPnl) : 'Unavailable'}</dd></div>
              <div><dt className={`text-[9px] uppercase tracking-wider ${th.textFaint}`}>Call capacity</dt><dd className={`mt-1 text-sm ${th.text}`}>{holding.direction === 'Short' ? '0 contracts' : symbolCapacity ? `${symbolCapacity.availableCoveredContracts} contracts` : 'Unavailable'}</dd></div>
            </dl>
          </article>
        );
      })}
    </section>
  );
}
