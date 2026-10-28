// features/research/ResearchFacts.tsx
'use client';

// RESEARCH-0002 (Ian + Alan): the facts that decide whether a ticker deserves a place in the screener, and where a strike would sit.
// Trend (the existing getTrend), options context (the broker's own IV rank, IV, HV30, earnings), and price structure (ATR, key levels,
// volume, relative strength vs SPY). Facts only: no score, no verdict.

import { useEffect, useMemo, useState } from 'react';
import type { ResearchFacts as Facts } from '@/lib/research/researchFacts';
import type { ChartLevel } from '@/lib/research/yahooChart';
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

interface Props {
  symbol: string; th: (typeof THEMES)[Theme]; deps: ResearchFactsDeps;
  /** Called with the levels to draw on the chart (support and resistance first, then the highs and lows); empty while loading or on error. Must be a stable function. */
  onLevels?: (levels: ChartLevel[]) => void;
  /** Called with the open gaps to shade on the chart; empty while loading or on error. Must be a stable function. */
  onGaps?: (gaps: Facts['gaps']) => void;
}

/** The chart's level lines, in priority order: key levels first, then the unconfirmed highs and lows. */
export function chartLevelsOf(f: Facts): ChartLevel[] {
  const out: ChartLevel[] = [];
  for (const l of f.levels?.supports ?? []) out.push({ price: l.price, kind: 'support', label: 'Support' });
  for (const l of f.levels?.resistances ?? []) out.push({ price: l.price, kind: 'resistance', label: 'Resistance' });
  const e = f.extremes;
  if (e) {
    for (const [label, v] of [['20-day high', e.high20], ['20-day low', e.low20], ['52-week high', e.high52w], ['52-week low', e.low52w]] as const) {
      if (v != null) out.push({ price: v, kind: 'extreme', label });
    }
  }
  return out;
}

const usd = (v: number | null | undefined) => (v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fixed = (v: number | null | undefined, d = 1, suffix = '') => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${suffix}`);
const signedInt = (v: number | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${Math.round(v)}`);
const dayDiff = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) / 86_400_000);

function Cell({ label, value, hint, th }: { label: string; value: string; hint?: string; th: Props['th'] }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${th.border}`} title={hint}>
      <dt className={`text-[10px] uppercase tracking-wider ${th.textFaint}`}>{label}</dt>
      <dd className={`text-sm font-bold ${th.text}`}>{value}</dd>
    </div>
  );
}

export function ResearchFacts({ symbol, th, deps, onLevels, onGaps }: Props) {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [factsError, setFactsError] = useState<string | null>(null);
  const [broker, setBroker] = useState<BrokerMetrics | null | undefined>(undefined);
  const [trend, setTrend] = useState<TrendResult | null | undefined>(undefined);
  const [strikeText, setStrikeText] = useState('');

  useEffect(() => { onLevels?.(facts ? chartLevelsOf(facts) : []); }, [facts, onLevels]);
  useEffect(() => { onGaps?.(facts?.gaps ?? []); }, [facts, onGaps]);

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
            <Cell th={th} label="Trend (screener read)" value={`${trend.trend} · ${trend.confidence.toFixed(0)}%${trend.subtype && trend.subtype !== 'UNKNOWN' ? ` · ${trend.subtype.toLowerCase()}` : ''}`} hint={trend.reason} />
            <Cell th={th} label="20 / 50 / 200-day avg" value={`${fixed(trend.ma20, 2)} / ${fixed(trend.ma50, 2)} / ${fixed(trend.ma200 ?? null, 2)}`} />
            <Cell th={th} label="RSI (14)" value={fixed(trend.metrics?.rsi14, 0)} />
            <Cell th={th} label="Price vs 50-day avg" value={fixed(trend.metrics?.distFromMa50 != null ? trend.metrics.distFromMa50 * 100 : null, 1, '%')} />
          </dl>}
      {trend && trend.trend !== 'unknown' && (
        <p className={`mt-2 text-xs ${th.textFaint}`} data-testid="facts-trend-why">
          {trend.scores ? <>What drives it: momentum {signedInt(trend.scores.momentum)} · averages {signedInt(trend.scores.maAlignment)} · slope {signedInt(trend.scores.slope)} · structure {signedInt(trend.scores.structure)}. </> : null}
          This is the screener's trend read: it weighs the last 20 to 60 trading days most, with the last 90 to 120 only as memory. Compare it with the 1M, 3M and 6M returns below.
        </p>
      )}

      <h3 className={`mt-4 text-[11px] font-semibold uppercase tracking-wider ${th.textMuted}`}>Options context</h3>
      {broker === undefined ? <p className={`mt-1 text-xs ${th.textFaint}`} role="status">Loading…</p>
        : broker === null ? <p className={`mt-1 text-xs ${th.textFaint}`}>Connect TastyTrade to see IV rank, volatility and earnings.</p>
        : <dl className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="facts-options">
            <Cell th={th} label="IV rank" value={fixed(broker.ivRank, 0, '%')} />
            <Cell th={th} label="IV (30-day)" value={fixed(broker.ivx30, 1, '%')} hint="The broker's 30-day implied volatility" />
            <Cell th={th} label="HV (30-day)" value={fixed(broker.hv30, 1, '%')} hint="Realized volatility, the broker's own measure" />
            <Cell th={th} label="IV minus HV" value={fixed(broker.ivHvDiff, 1, ' pts')} hint="Positive: options price in more movement than the stock has delivered" />
            <Cell th={th} label="Next earnings" value={broker.earningsExpectedDate ? `${broker.earningsExpectedDate}${earningsDays == null ? '' : earningsDays >= 0 ? ` (${earningsDays}d)` : ' (passed)'}` : '—'} hint={earningsDays != null && earningsDays < 0 ? 'The broker still lists a date that has already gone by; the next report date is not yet published.' : undefined} />
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
              <Cell th={th} label="Return 1M · 3M · 6M" value={[facts.returns?.m1, facts.returns?.m3, facts.returns?.m6].map(v => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)).join(' · ')} hint="Change in the last close over 21, 63 and 126 completed sessions" />
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
            {facts.extremes ? (
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="facts-extremes">
                {([['20-day high', facts.extremes.high20], ['20-day low', facts.extremes.low20], ['52-week high', facts.extremes.high52w], ['52-week low', facts.extremes.low52w]] as const).map(([label, v]) => (
                  <Cell key={label} th={th} label={label} value={v != null ? usd(v) : '—'} hint={v != null ? `${(Math.abs(facts.price - v) / facts.price * 100).toFixed(1)}% ${v < facts.price ? 'below' : 'above'} price. Needs no confirmation.` : 'Not enough history'} />
                ))}
              </dl>
            ) : null}
            {facts.gaps && facts.gaps.length > 0 ? (
              <div className="mt-3" data-testid="facts-gaps">
                <p className={`text-[10px] uppercase tracking-wider ${th.textFaint}`}>Open gaps</p>
                <ul className="mt-1 space-y-1">
                  {facts.gaps.map(g => (
                    <li key={`${g.t}-${g.bottom}`} className={`text-xs ${th.text}`}>{usd(g.bottom)} to {usd(g.top)} <span className={th.textFaint}>· {g.side === 'above' ? 'above price' : g.side === 'below' ? 'below price' : 'price is inside it'} · gapped {new Date(g.t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></li>
                  ))}
                </ul>
              </div>
            ) : null}

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
