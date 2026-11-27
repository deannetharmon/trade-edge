'use client';

// features/screener/components/CcAllCallsModal.tsx
//
// CHAIN-ALL-0001 slice 1: "Show all calls". The whole call chain for one expiration with no filters, so a call someone else
// recommends is never hidden. Each row says in plain words why it is not a pick. Rules (Ian, Dean 2026-11-27):
//   - no order button on a row that is below your cost, under the stock price, or has any other reason; only picks get one
//   - the order button is also off while the RSI wait applies, and when the cost basis is unknown
//   - a pick opens the normal CcTradeModal, with the same checks as today
// Broker reads happen here, in the browser, when the button is pressed; nothing in the scan changes.

import { useEffect, useMemo, useState } from 'react';
import { THEMES, getSavedTheme } from '@/lib/theme';
import type { Theme } from '@/lib/theme';
import type { ScreenResult } from '@/lib/scans/types';
import type { CcOrderDeps } from '@/lib/scans/ccOrderDeps';
import { defaultCcOrderDeps } from '@/lib/scans/ccOrderDeps';
import { defaultLookupDeps } from '@/lib/tradeLookup/defaultDeps';
import type { LookupDeps } from '@/lib/tradeLookup/loadLookup';
import type { ChainRow } from '@/lib/tradeLookup/lookupTypes';
import { normalizeChainRows } from '@/lib/tradeLookup/chainRows';
import { allBelowCost, balancedPickStrike, buildCcAllRows, CC_BALANCED_POP, gapTone, rowChips, sortCcAllRows, type CcAllRow, type CcAllSortKey } from '@/lib/scans/ccAllCalls';
import type { CcLot } from '@/lib/scans/ccLotLoss';
import { ccExpirationLabel, ccStrikeLabel, ccTimingNote } from '@/lib/scans/ccGuidance';
import { daysUntil } from '@/lib/scans/scan-utils';
import { trendRsiForDisplay } from '@/lib/scans/trendRsi';
import { useCcRsiCutoff } from '@/features/screener/useCcRsiCutoff';
import { useCcMinPay } from '@/features/screener/useCcMinPay';
import { CcTradeModal, type CcOrderInput } from './CcTradeModal';
import { CcRecoveryPanel } from './CcRecoveryPanel';

export interface CcAllCallsDeps {
  lookup: Pick<LookupDeps, 'getToken' | 'getListedExpirations' | 'fetchChain' | 'getUnderlyingPrice'>;
  order: CcOrderDeps;
}
const REAL_DEPS: CcAllCallsDeps = { lookup: defaultLookupDeps, order: defaultCcOrderDeps };

const columnWidths = 'grid grid-cols-[4rem_minmax(7rem,1.25fr)_5rem_6rem_5rem_6rem_minmax(8rem,1.5fr)] gap-x-3 px-3';
function calledAwayEstimate(delta: number | null) {
  if (delta === null || !Number.isFinite(delta) || delta < 0 || delta > 1) return '—';
  const pct = Math.round(delta * 100);
  if (pct === 0) return '<1%';
  if (pct === 100) return '>99%';
  return `~${pct}%`;
}
const usd = (n: number) => `$${n.toFixed(2)}`;

/** th is optional: a caller that only has a narrow theme (the disqualified list) lets the button read the saved one when it opens. */
export function CcAllCallsButton({ result, th, deps }: { result: ScreenResult; th?: typeof THEMES[Theme]; deps?: CcAllCallsDeps }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="cc-all-calls-open" onClick={() => setOpen(true)}
        className="rounded border border-cyan-500 px-2 py-0.5 text-[13px] font-bold text-cyan-300">Show all calls</button>
      {open && <CcAllCallsModal result={result} th={th ?? THEMES[getSavedTheme()]} deps={deps ?? REAL_DEPS} onClose={() => setOpen(false)} />}
    </>
  );
}

export function CcAllCallsModal({ result, th, deps, onClose }: { result: ScreenResult; th: typeof THEMES[Theme]; deps: CcAllCallsDeps; onClose: () => void }) {
  const symbol = result.symbol;
  const [cutoff] = useCcRsiCutoff();
  const [minPay] = useCcMinPay();
  const [token, setToken] = useState<string | null>(null);
  const [listed, setListed] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [rows, setRows] = useState<ChainRow[] | null>(null);
  const [isIndex, setIsIndex] = useState(result.underlyingType === 'index');
  const [price, setPrice] = useState<number | null>(typeof result.price === 'number' && result.price > 0 ? result.price : null);
  const [contracts, setContracts] = useState<number | null>(null);
  const [lots, setLots] = useState<CcLot[] | null>(null);
  const [lotsSettled, setLotsSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [order, setOrder] = useState<CcOrderInput | null>(null);
  const [showUnder, setShowUnder] = useState(false);
  const [recovery, setRecovery] = useState(false); // Recovery mode: opt-in, this ticker, forgotten on close
  const [sort, setSort] = useState<{ key: CcAllSortKey; dir: 'asc' | 'desc' }>({ key: 'strike', dir: 'asc' });

  // 1. Token, the listed expirations, the live price, and (in parallel) the share lots.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = await deps.lookup.getToken();
        if (!alive) return;
        if (!t) { setError('Broker session expired. Sign in again to see the chain.'); setLotsSettled(true); return; }
        setToken(t);
        const [exps, px] = await Promise.all([
          deps.lookup.getListedExpirations(symbol, t),
          deps.lookup.getUnderlyingPrice(symbol, t).catch(() => null),
        ]);
        if (!alive) return;
        if (typeof px === 'number' && px > 0) setPrice(px);
        const future = exps.filter(e => daysUntil(e) >= 1);
        setListed(future);
        const fromScan = result.ccGrid?.expirations?.[0]?.expiration;
        setSelected(fromScan && future.includes(fromScan) ? fromScan : (future.find(e => daysUntil(e) >= 7) ?? future[0] ?? null));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load the chain.');
      }
    })();
    (async () => {
      try {
        const reports = await deps.order.readCoverage();
        const cap = reports?.capacity?.bySymbol?.[symbol];
        if (alive && cap && Number.isFinite(cap.availableCoveredContracts)) setContracts(cap.availableCoveredContracts);
        if (deps.order.readLots && cap && typeof cap.sharesOwned === 'number' && cap.sharesOwned > 0) {
          const l = await deps.order.readLots(symbol, cap.sharesOwned);
          if (alive) setLots(l);
        }
      } catch { /* lots stay null: the cost falls back to the scan's basis */ }
      if (alive) setLotsSettled(true);
    })();
    return () => { alive = false; };
  }, [symbol]);

  // 2. The chain for the picked expiration, fetched only when picked.
  useEffect(() => {
    if (!token || !selected) return;
    let alive = true;
    setRows(null); setExpanded(null);
    deps.lookup.fetchChain(symbol, token, selected).then(
      c => { if (!alive) return; setRows(normalizeChainRows(c.chains)); if (c.classification === 'index') setIsIndex(true); },
      e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load that date.'); },
    );
    return () => { alive = false; };
  }, [token, selected, symbol]);

  const basisInfo = result.ccBasis ?? null;
  const base = basisInfo?.basis ?? null;
  const typed = basisInfo?.source === 'typed';
  const lotFloor = lots && lots.length > 0 ? Math.max(...lots.map(l => l.price)) : null;
  // Same rule as the order dialog: the highest lot wins unless the trader typed a basis.
  const floorBasis = typed ? base : (lotFloor !== null && (base === null || lotFloor > base) ? lotFloor : base);
  const fromLots = !typed && lotFloor !== null && floorBasis === lotFloor;
  const rsi = trendRsiForDisplay(result.trendResult?.metrics);
  const note = ccTimingNote({ symbol, rsi, price, basis: floorBasis, cutoff });
  const waiting = note.state === 'wait';
  const dte = selected ? daysUntil(selected) : 0;
  const ready = rows !== null && lotsSettled;
  const all: CcAllRow[] = useMemo(
    () => (ready && rows ? buildCcAllRows({ rows, dte, stockPrice: price, floorBasis, lots, minPayChip: minPay }) : []),
    [ready, rows, dte, price, floorBasis, lots, minPay],
  );
  const shared = allBelowCost(all);
  const canOrder = floorBasis !== null && !waiting;
  const balanced = canOrder ? balancedPickStrike(all) : null;
  const balancedRow = balanced === null ? null : all.find(r => r.strike === balanced) ?? null;
  // Calls under the stock price are mostly stock value, not premium, so they start folded away.
  const underCount = all.filter(r => r.reasons.includes('in_the_money')).length;
  const visible = useMemo(() => sortCcAllRows(showUnder ? all : all.filter(r => !r.reasons.includes('in_the_money')), sort.key, sort.dir), [all, showUnder, sort]);
  const sortAscending = (sort.dir === 'asc') !== (sort.key === 'keep');
  const bySt = sort.key === 'strike' && sort.dir === 'asc';
  const firstAbove = bySt ? visible.find(r => !r.reasons.includes('in_the_money'))?.strike ?? null : null;

  const startOrder = (r: CcAllRow) => {
    if (!r.mid || !canOrder) return;
    setOrder({
      symbol, occSymbol: r.occSymbol, strike: r.strike, expiration: r.expiration, dte: r.dte,
      delta: r.popPct === null ? null : (100 - r.popPct) / 100,
      midPerShare: r.mid, isIndex, stockPrice: price,
      bidPerShare: r.bid, askPerShare: r.ask, wide: false,
      typedBasis: (basisInfo?.source === 'typed' || basisInfo?.source === 'adjusted') && base !== null && base > 0 ? base : null,
    });
  };

  // Recovery mode is only for shares priced under their cost, and only once the lots are proven.
  const underwater = lotsSettled && lots !== null && lots.length > 0 && price !== null && floorBasis !== null && price < floorBasis;
  const recoveryOn = recovery && underwater;
  const chips = listed.filter(e => daysUntil(e) <= 45).slice(0, 4);
  const more = listed.filter(e => !chips.includes(e));

  return (
    <div role="dialog" aria-modal="true" aria-label={`All calls for ${symbol}`} data-testid="cc-all-calls"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4">
      <div className="max-h-full w-full max-w-6xl space-y-3 overflow-auto overscroll-contain rounded-xl border border-neutral-700 bg-neutral-950 p-5 text-neutral-100">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-wide">{symbol} · ALL CALLS</h2>
          <button type="button" onClick={onClose} data-testid="cc-all-calls-close" className="rounded border border-neutral-600 px-3 py-1 text-sm text-neutral-300">Close</button>
        </div>
        <p className="text-sm text-neutral-300" data-testid="cc-all-calls-summary">
          {price !== null ? `Stock ${usd(price)}` : 'Stock price unknown'}
          {typeof rsi === 'number' ? ` · RSI ${Math.round(rsi)}` : ''}
          {floorBasis !== null ? ` · your cost ${usd(floorBasis)}${fromLots ? ' (highest-cost lot)' : ''}` : ' · cost basis unknown'}
          {contracts !== null ? ` · covers ${contracts} contract${contracts === 1 ? '' : 's'}` : ''}
        </p>
        {waiting && <p data-testid="cc-all-calls-wait" className="rounded-lg border border-amber-400 px-3 py-2 text-sm text-amber-200">{note.lines[0]} You can still look at everything.</p>}
        {floorBasis === null && lotsSettled && <p className="rounded-lg border border-red-400 px-3 py-2 text-sm font-bold text-red-300">Cost basis unknown. No call without one.</p>}
        {shared && floorBasis !== null && <p data-testid="cc-all-calls-band" className="rounded-lg border border-red-400 px-3 py-2 text-sm font-bold text-red-300">All strikes are below your {usd(floorBasis)} cost</p>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

        {underwater && (
          <div className="flex items-center gap-3">
            <button type="button" data-testid="cc-recovery-toggle" aria-pressed={recoveryOn} onClick={() => setRecovery(v => !v)}
              className={`rounded-full px-4 py-1.5 text-sm font-bold ${recoveryOn ? 'bg-amber-400 text-black' : 'border border-amber-400 text-amber-200'}`}>Recovery mode: {recoveryOn ? 'ON' : 'OFF'}</button>
            {!recoveryOn && <span className="text-xs text-neutral-400">For shares under your cost. Off until you turn it on.</span>}
          </div>
        )}
        {recoveryOn && price !== null && floorBasis !== null && lots && (
          <CcRecoveryPanel symbol={symbol} token={token} listed={listed} price={price} floorBasis={floorBasis} lots={lots} contracts={contracts}
            minPay={minPay} waiting={waiting} waitLine={note.lines[0] ?? ''} deps={deps} onOrder={startOrder} />
        )}
        {!recoveryOn && (
          <>
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(e => (
            <button key={e} type="button" aria-pressed={e === selected} onClick={() => setSelected(e)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${e === selected ? 'border-cyan-400 bg-cyan-400 font-bold text-black' : 'border-neutral-600 text-neutral-300'}`}>{ccExpirationLabel(e)} · {daysUntil(e)} days</button>
          ))}
          {more.length > 0 && (
            <select aria-label="More dates" value={selected && more.includes(selected) ? selected : ''} onChange={e => e.target.value && setSelected(e.target.value)}
              className="rounded-lg border border-neutral-600 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-300">
              <option value="">More dates</option>
              {more.map(e => <option key={e} value={e}>{ccExpirationLabel(e)} · {daysUntil(e)} days</option>)}
            </select>
          )}
        </div>

        {!error && !ready && <p data-testid="cc-all-calls-loading" className="text-sm text-neutral-400">{rows === null ? 'Loading the chain…' : 'Checking your share lots…'}</p>}
        {ready && visible.length === 0 && all.length > 0 && <p className="text-sm text-neutral-400">Every strike on this date is under the stock price. Use the toggle below to see them.</p>}
        {ready && all.length === 0 && <p className="text-sm text-neutral-400">No calls listed for that date.</p>}
        {ready && all.length > 0 && (
          <p data-testid="cc-all-calls-balanced" className={`rounded-lg border px-3 py-2 text-sm ${balancedRow ? 'border-emerald-400 text-emerald-200' : 'border-neutral-700 text-neutral-300'}`}>
            {balancedRow
              ? `Balanced pick · ${ccStrikeLabel(balancedRow.strike)} · ${usd(balancedRow.timeValue ?? 0)} time value per contract · ${calledAwayEstimate(balancedRow.delta)} estimated called-away chance at expiration`
              : `No balanced pick for this expiration. ${shared ? 'Every strike is below your cost.' : waiting ? 'Wait for the RSI threshold.' : floorBasis === null ? 'Your cost basis is unknown.' : `No call passes your rules with an estimated ${100 - CC_BALANCED_POP.hi}–${100 - CC_BALANCED_POP.lo}% chance of being called away.`}`}
          </p>
        )}
        {ready && underCount > 0 && (
          <button type="button" data-testid="cc-all-calls-under" onClick={() => setShowUnder(v => !v)} aria-expanded={showUnder}
            className="rounded-lg border border-neutral-600 px-3 py-1.5 text-sm text-neutral-300">{showUnder ? 'Hide' : 'Show'} {underCount} strike{underCount === 1 ? '' : 's'} under the stock price</button>
        )}
        {ready && visible.length > 0 && (
          <p className="text-xs text-neutral-400">Time value uses the bid–ask midpoint and excludes intrinsic value. Your fill may differ. The called-away estimate uses option delta as a rough guide to finishing in the money. Early assignment can also occur.</p>
        )}
        {ready && visible.length > 0 && (
          <div className="min-w-[740px] space-y-1.5" data-testid="cc-all-calls-rows">
            <div className={`${columnWidths} sticky top-0 z-10 items-center rounded-t-lg border border-neutral-700 bg-neutral-900 py-2 text-sm font-semibold text-neutral-100`}>
              {([['strike', 'Strike', 'Strike price'], ['premium', 'Time value', 'Time value per contract'], ['above', 'vs. Stock', 'Strike vs. stock price'], ['keep', 'Called away', 'Chance called away'], ['gap', 'Bid–ask', 'Bid–ask gap per share'], ['oi', 'Open interest', 'Open interest']] as Array<[CcAllSortKey, string, string]>).map(([k, label, description]) => (
                <button key={k} type="button" data-testid={`cc-all-sort-${k}`} title={description} aria-label={sort.key === k ? `${description}, sorted ${sortAscending ? 'ascending' : 'descending'}` : description}
                  onClick={() => setSort(sort.key === k ? { key: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'strike' || k === 'gap' ? 'asc' : 'desc' })}
                  className={`text-left ${sort.key === k ? 'text-cyan-300' : ''}`}>{label}{sort.key === k ? (sortAscending ? ' ▲' : ' ▼') : ''}</button>
              ))}
              <div>Checks</div>
            </div>
            {visible.map(r => {
              const under = r.reasons.includes('in_the_money');
              const chipsText = rowChips(r, minPay, shared);
              const open = expanded === r.strike;
              return (
                <div key={r.occSymbol || r.strike}>
                  {showUnder && r.strike === firstAbove && price !== null && <p className="py-1 text-sm font-bold text-cyan-300">Stock now {usd(price)}. Higher strikes are above the stock price.</p>}
                  <button type="button" onClick={() => setExpanded(open ? null : r.strike)} aria-expanded={open} data-testid={`cc-all-row-${r.strike}`}
                    className={`${columnWidths} w-full items-center rounded-lg border py-2 text-left text-sm tabular-nums ${open ? 'border-cyan-400 bg-cyan-950/40' : 'border-neutral-800 bg-neutral-900'}`}>
                    <div className="font-bold">{ccStrikeLabel(r.strike)}</div>
                    <div>{r.collect !== null ? <><b>{usd(r.timeValue ?? 0)}</b><span className="block text-xs text-neutral-400">{under ? `${usd(r.collect)} total credit` : `Bid ${r.bid?.toFixed(2)} · Ask ${r.ask?.toFixed(2)}`}</span></> : '—'}</div>
                    <div>{r.abovePricePct !== null ? `${r.abovePricePct > 0 ? '+' : ''}${r.abovePricePct.toFixed(1)}%` : '—'}</div>
                    <div>{calledAwayEstimate(r.delta)}</div>
                    <div data-testid={`cc-all-gap-${r.strike}`} data-tone={gapTone(r) ?? 'none'} className={`font-bold ${{ green: 'text-emerald-400', yellow: 'text-yellow-300', red: 'text-red-400', none: '' }[gapTone(r) ?? 'none']}`}>{r.gapCents !== null ? `$${(r.gapCents / 100).toFixed(2)}` : '—'}</div>
                    <div className={`${r.openInterest === 0 ? 'text-amber-300' : ''}`}>{r.openInterest !== null ? r.openInterest.toLocaleString('en-US') : '—'}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {r.isPick && <span className="rounded-full border border-emerald-400 px-2 text-xs font-bold text-emerald-300">{r.strike === balanced ? 'Balanced pick' : 'Passes scan rules'}</span>}
                      {chipsText.map(c => <span key={c} className="rounded-full border border-amber-400 px-2 text-xs font-bold text-amber-200">{c}</span>)}
                    </div>
                  </button>
                  {open && (
                    <div className="mt-1 space-y-2 rounded-lg border border-cyan-400 bg-cyan-950/40 px-4 py-3 text-sm" data-testid={`cc-all-detail-${r.strike}`}>
                      <p>{r.isPick ? 'This call passes your rules.' : `Not a pick: ${r.reasons.map(x => x === 'pays_under' ? `pays under $${Math.max(minPay, 10)}` : x === 'below_cost' ? `the ${ccStrikeLabel(r.strike)} strike is below your cost` : x === 'in_the_money' ? 'the strike is under the stock price' : x === 'wide' ? 'the price gap is too big' : 'no quote').join(', ')}.`}</p>
                      {r.lotLossLine && <p className="text-red-300" data-testid={`cc-all-lotloss-${r.strike}`}>{r.lotLossLine}</p>}
                      {r.isPick && canOrder && <button type="button" onClick={() => startOrder(r)} data-testid={`cc-all-order-${r.strike}`} className="rounded-lg border border-cyan-400 px-4 py-2 text-sm font-bold text-cyan-300">Review order</button>}
                      {r.isPick && !canOrder && <p className="text-xs text-neutral-400">{waiting ? 'Order is off until the RSI wait is over.' : 'Order is off without a cost basis.'}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
          </>
        )}
      </div>
      {order && <CcTradeModal th={th} order={order} deps={deps.order} onClose={() => setOrder(null)} />}
    </div>
  );
}
