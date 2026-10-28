// features/research/ResearchFacts.tsx
'use client';

// RESEARCH-0002 (Ian + Alan): the facts that decide whether a ticker deserves a place in the screener, and where a strike would sit.
// Trend (the existing getTrend), options context (the broker's own IV rank, IV, HV30, earnings), and price structure (ATR, key levels,
// volume, relative strength vs SPY). Facts only: no score, no verdict.

import { useEffect, useMemo, useState } from 'react';
import type { ResearchFacts as Facts } from '@/lib/research/researchFacts';
import { strikeContext } from '@/lib/research/techFacts';
import type { TrendResult } from '@/lib/scans/types';
import type { THEMES, Theme } from '@/lib/theme';

export interface BrokerMetrics {
  /** All volatilities are percent numbers (62.3 means 62.3%). */
  ivRank: number | null; ivx30: number | null; hv30: number | null; ivHvDiff: number | null;
  earningsExpectedDate: string | null; liquidityRating: number | null;
}

export interface ResearchFactsDeps {
  loadFacts: (symbol: string) => Promise<Facts>;
  /** Null when the broker is not connected; never throws into the UI. */
  loadBroker: (symbol: string) => Promise<BrokerMetrics | null>;
  loadTrend: (symbol: string) => Promise<TrendResult | null>;
}

interface Props { symbol: string; th: (typeof THEMES)[Theme]; deps: ResearchFactsDeps }

const usd = (v: number | null | undefined) => (v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fixed = (v: number | null | undefined, d = 1, suffix = '') => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${suffix}`);
const dayDiff = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) / 86_400_000);

function Cell({ label, value, hint, th }: { label: string; value: string; hint?: string; th: Props['th'] }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${th.border}`} title={hint}>
      <dt className={`text-[10px] uppercase tracking-wider ${th.textFaint}`}>{label}</dt>
      <dd className={`text-sm font-bold ${th.text}`}>{value}</dd>
    </div>
  );
}

export function ResearchFacts({ symbol, th, deps }: Props) {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [factsError, setFactsError] = useState<string | null>(null);
  const [broker, setBroker] = useState<BrokerMetrics | null | undefined>(undefined);
  const [trend, setTrend] = useState<TrendResult | null | undefined>(undefined);
  const [strikeText, setStrikeText] = useState('');

  useEffect(() => {
    let live = true;
    setFacts(null); setFactsError(null); setBroker(undefined); setTrend(undefined); setStrikeText('');
    deps.loadFacts(symbol).then(f => { if (live) setFacts(f); }).catch(e => { if (live) setFactsError(e instanceof Error ? e.message : 'Facts unavailable'); });
    deps.loadBroker(symbol).then(b => { if (live) setBroker(b); }).catch(() => { if (live) setBroker(null); });
    deps.loadTrend(symbol).then(t => { if (live) setTrend(t); }).catch(() => { if (live) setTrend(null); });
    return () => { live = false; };
  }, [symbol, deps]);

  const strike = Number(strikeText);
  const context = useMemo(
    () => (facts && strikeText.trim() !== '' && Number.isFinite(strike) && strike > 0 ? strikeContext(strike, facts.price, facts.atr14, facts.levels) : null),
    [facts, strike, strikeText],
  );
  const earningsDays = broker?.earningsExpectedDate ? dayDiff(broker.earningsExpectedDate) : null;

  return (
    <section aria-label={`${symbol} facts`} className={`mt-4 rounded-xl border ${th.border} ${th.card} p-4 sm:p-5`} data-testid="research-facts">
      <h2 className={`text-xs font-bold uppercase tracking-widest ${th.textFaint}`}>Facts for a premium sale</h2>

      <h3 className={`mt-4 text-[11px] font-semibold uppercase tracking-wider ${th.textMuted}`}>Trend</h3>
      {trend === undefined ? <p className={`mt-1 text-xs ${th.textFaint}`} role="status">Loading…</p>
        : trend === null || trend.trend === 'unknown' ? <p className={`mt-1 text-xs ${th.textFaint}`}>Trend unavailable.</p>
        : <dl className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="facts-trend">
            <Cell th={th} label="Trend" value={`${trend.trend} · ${trend.confidence.toFixed(0)}%`} hint={trend.reason} />
            <Cell th={th} label="20 / 50 / 200-day avg" value={`${fixed(trend.ma20, 2)} / ${fixed(trend.ma50, 2)} / ${fixed(trend.ma200 ?? null, 2)}`} />
            <Cell th={th} label="RSI (14)" value={fixed(trend.metrics?.rsi14, 0)} />
            <Cell th={th} label="Price vs 50-day avg" value={fixed(trend.metrics?.distFromMa50 != null ? trend.metrics.distFromMa50 * 100 : null, 1, '%')} />
          </dl>}

      <h3 className={`mt-4 text-[11px] font-semibold uppercase tracking-wider ${th.textMuted}`}>Options context</h3>
      {broker === undefined ? <p className={`mt-1 text-xs ${th.textFaint}`} role="status">Loading…</p>
        : broker === null ? <p className={`mt-1 text-xs ${th.textFaint}`}>Connect TastyTrade to see IV rank, volatility and earnings.</p>
        : <dl className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="facts-options">
            <Cell th={th} label="IV rank" value={fixed(broker.ivRank, 0, '%')} />
            <Cell th={th} label="IV (30-day)" value={fixed(broker.ivx30, 1, '%')} hint="The broker's 30-day implied volatility" />
            <Cell th={th} label="HV (30-day)" value={fixed(broker.hv30, 1, '%')} hint="Realized volatility, the broker's own measure" />
            <Cell th={th} label="IV minus HV" value={fixed(broker.ivHvDiff, 1, ' pts')} hint="Positive: options price in more movement than the stock has delivered" />
            <Cell th={th} label="Next earnings" value={broker.earningsExpectedDate ? `${broker.earningsExpectedDate}${earningsDays != null && earningsDays >= 0 ? ` (${earningsDays}d)` : ''}` : '—'} />
            <Cell th={th} label="Options liquidity" value={fixed(broker.liquidityRating, 0, ' / 5')} />
          </dl>}

      <h3 className={`mt-4 text-[11px] font-semibold uppercase tracking-wider ${th.textMuted}`}>Price structure</h3>
      {factsError ? <p role="alert" className="mt-1 text-xs text-amber-300">{factsError}</p>
        : !facts ? <p className={`mt-1 text-xs ${th.textFaint}`} role="status">Loading…</p>
        : <>
            <dl className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="facts-structure">
              <Cell th={th} label="ATR (14)" value={facts.atr14 != null ? `${usd(facts.atr14)} (${fixed(facts.atrPct, 1, '%')})` : '—'} hint="Average daily range. A 1-ATR move is the typical day." />
              <Cell th={th} label="Volume, 20d vs 60d" value={facts.volumeRatio != null ? `${facts.volumeRatio.toFixed(2)}×` : '—'} />
              <Cell th={th} label="6-mo vs SPY" value={facts.relativeStrength ? `${facts.relativeStrength.diffPts >= 0 ? '+' : ''}${facts.relativeStrength.diffPts.toFixed(1)} pts` : '—'} hint={facts.relativeStrength ? `Stock ${facts.relativeStrength.stockPct.toFixed(1)}% vs SPY ${facts.relativeStrength.benchmarkPct.toFixed(1)}%` : 'Not enough history'} />
              <Cell th={th} label="Last close" value={usd(facts.price)} />
            </dl>
            {facts.levels ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="facts-levels">
                {([['Support below', facts.levels.supports], ['Resistance above', facts.levels.resistances]] as const).map(([title, list]) => (
                  <div key={title}>
                    <p className={`text-[10px] uppercase tracking-wider ${th.textFaint}`}>{title}</p>
                    {list.length === 0 ? <p className={`text-xs ${th.textFaint}`}>None found in the last year.</p>
                      : <ul className="mt-1 space-y-1">{list.map(l => <li key={l.price} className={`text-xs ${th.text}`}>{usd(l.price)} <span className={th.textFaint}>· {l.touches} touch{l.touches === 1 ? '' : 'es'} · {(Math.abs(facts.price - l.price) / facts.price * 100).toFixed(1)}% {l.price < facts.price ? 'below' : 'above'} price</span></li>)}</ul>}
                  </div>
                ))}
              </div>
            ) : <p className={`mt-2 text-xs ${th.textFaint}`}>Key levels need at least 60 trading days of history.</p>}

            <div className={`mt-4 rounded-lg border p-3 ${th.border}`}>
              <label className={`text-xs ${th.textMuted}`}>Check a put strike
                <input value={strikeText} onChange={e => setStrikeText(e.target.value)} inputMode="decimal" placeholder="e.g. 70" aria-label="Put strike" className={`ml-2 w-24 rounded border px-2 py-1 text-xs ${th.input} ${th.inputBorder} ${th.text}`} />
              </label>
              {context && (
                <p className={`mt-2 text-xs ${th.text}`} data-testid="strike-context">
                  ${strike.toFixed(2)} is {context.pctBelowPrice.toFixed(1)}% {context.pctBelowPrice >= 0 ? 'below' : 'above'} the last close
                  {context.atrsBelowPrice != null ? ` (${context.atrsBelowPrice.toFixed(1)} ATR)` : ''}.
                  {context.nearestSupportBelowStrike ? ` Nearest support at or below it: ${usd(context.nearestSupportBelowStrike.price)}, ${context.nearestSupportBelowStrike.pctBelowStrike.toFixed(1)}% under the strike.` : ' No support found at or below it.'}
                </p>
              )}
            </div>
          </>}
    </section>
  );
}
