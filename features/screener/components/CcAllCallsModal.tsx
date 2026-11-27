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

export interface CcAllCallsDeps {
  lookup: Pick<LookupDeps, 'getToken' | 'getListedExpirations' | 'fetchChain' | 'getUnderlyingPrice'>;
  order: CcOrderDeps;
}
const REAL_DEPS: CcAllCallsDeps = { lookup: defaultLookupDeps, order: defaultCcOrderDeps };

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
  const balanced = balancedPickStrike(all);
  const balancedRow = balanced === null ? null : all.find(r => r.strike === balanced) ?? null;
  // Calls under the stock price are mostly stock value, not premium, so they start folded away.
  const underCount = all.filter(r => r.reasons.includes('in_the_money')).length;
  const visible = useMemo(() => sortCcAllRows(showUnder ? all : all.filter(r => !r.reasons.includes('in_the_money')), sort.key, sort.dir), [all, showUnder, sort]);
  const bySt = sort.key === 'strike' && sort.dir === 'asc';
  const firstAbove = bySt ? visible.find(r => !r.reasons.includes('in_the_money'))?.strike ?? null : null;
  const canOrder = floorBasis !== null && !waiting;

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

  const chips = listed.filter(e => daysUntil(e) <= 45).slice(0, 4);
  const more = listed.filter(e => !chips.includes(e));

  return (
    <div role="dialog" aria-modal="true" aria-label={`All calls for ${symbol}`} data-testid="cc-all-calls"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4">
      <div className="w-full max-w-4xl space-y-3 rounded-xl border border-neutral-700 bg-neutral-950 p-5 text-neutral-100">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-wide">{symbol} · ALL CALLS</h2>
          <button type="button" onClick={onClose} data-testid="cc-all-calls-close" className="rounded border border-neutral-600 px-3 py-1 text-sm text-neutral-300">Close</button>
        </div>
        <p className="text-sm text-neutral-300" data-testid="cc-all-calls-summary">
          {price !== null ? `Stock ${usd(price)}` : 'Stock price unknown'}
          {typeof rsi === 'number' ? ` · RSI ${Math.round(rsi)}` : ''}
          {floorBasis !== null ? ` · your cost ${usd(floorBasis)}${fromLots ? ' (oldest shares)' : ''}` : ' · cost basis unknown'}
          {contracts !== null ? ` · covers ${contracts} contract${contracts === 1 ? '' : 's'}` : ''}
        </p>
        {waiting && <p data-testid="cc-all-calls-wait" className="rounded-lg border border-amber-400 px-3 py-2 text-sm text-amber-200">{note.lines[0]} You can still look at everything.</p>}
        {floorBasis === null && lotsSettled && <p className="rounded-lg border border-red-400 px-3 py-2 text-sm font-bold text-red-300">Cost basis unknown. No call without one.</p>}
        {shared && floorBasis !== null && <p data-testid="cc-all-calls-band" className="rounded-lg border border-red-400 px-3 py-2 text-sm font-bold text-red-300">All strikes are below your {usd(floorBasis)} cost</p>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

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
        {ready && visible.length === 0 && all.length > 0 && <p className="text-sm text-neutral-400">Every strike on this date is under the stock price. Use the button above to see them.</p>}
        {ready && all.length === 0 && <p className="text-sm text-neutral-400">No calls listed for that date.</p>}
        {ready && all.length > 0 && (
          <p data-testid="cc-all-calls-balanced" className={`rounded-lg border px-3 py-2 text-sm ${balancedRow ? 'border-emerald-400 text-emerald-200' : 'border-neutral-700 text-neutral-300'}`}>
            {balancedRow
              ? `Balanced pick: the ${ccStrikeLabel(balancedRow.strike)} strike collects $${Math.round(balancedRow.timeValue ?? 0)} and you keep your shares ${balancedRow.popPct}% of the time.${waiting ? ' Wait for RSI first.' : ''}`
              : `No balanced pick on this date: ${shared ? 'every strike is below your cost.' : `no call passes your rules with a ${CC_BALANCED_POP.lo} to ${CC_BALANCED_POP.hi}% chance of keeping your shares.`}`}
          </p>
        )}
        {ready && underCount > 0 && (
          <button type="button" data-testid="cc-all-calls-under" onClick={() => setShowUnder(v => !v)} aria-expanded={showUnder}
            className="rounded-lg border border-neutral-600 px-3 py-1.5 text-sm text-neutral-300">{showUnder ? 'Hide' : 'Show'} {underCount} strike{underCount === 1 ? '' : 's'} under the stock price</button>
        )}
        {ready && visible.length > 0 && (
          <div className="space-y-1.5" data-testid="cc-all-calls-rows">
            <div className="flex px-3 text-xs font-bold tracking-wider text-neutral-400">
              {([['strike', 'STRIKE', 'w-16'], ['premium', 'PREMIUM YOU COLLECT', 'w-40'], ['above', 'ABOVE PRICE', 'w-24'], ['keep', 'KEEP SHARES', 'w-24'], ['gap', 'PRICE GAP', 'w-20'], ['oi', 'OPEN INTEREST', 'w-28']] as Array<[CcAllSortKey, string, string]>).map(([k, label, w]) => (
                <button key={k} type="button" data-testid={`cc-all-sort-${k}`} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  onClick={() => setSort(sort.key === k ? { key: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'strike' || k === 'gap' ? 'asc' : 'desc' })}
                  className={`${w} text-left ${sort.key === k ? 'text-cyan-300' : ''}`}>{label}{sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button>
              ))}
              <div className="flex-1">WHY</div>
            </div>
            {visible.map(r => {
              const under = r.reasons.includes('in_the_money');
              const chipsText = rowChips(r, minPay, shared);
              const open = expanded === r.strike;
              return (
                <div key={r.occSymbol || r.strike}>
                  {showUnder && r.strike === firstAbove && price !== null && <p className="py-1 text-sm font-bold text-cyan-300">Stock now {usd(price)}. Higher strikes are above the stock price.</p>}
                  <button type="button" onClick={() => setExpanded(open ? null : r.strike)} aria-expanded={open} data-testid={`cc-all-row-${r.strike}`}
                    className={`flex w-full items-center rounded-lg border px-3 py-2 text-left text-sm ${open ? 'border-cyan-400 bg-cyan-950/40' : 'border-neutral-800 bg-neutral-900'}`}>
                    <div className="w-16 font-bold">{ccStrikeLabel(r.strike)}</div>
                    <div className="w-40">{r.collect !== null ? <><b>${Math.round(r.timeValue ?? 0)}</b> <span className="text-xs text-neutral-400">{under ? `of $${Math.round(r.collect)}, rest is stock value` : `${r.bid?.toFixed(2)} / ${r.ask?.toFixed(2)}`}</span></> : '—'}</div>
                    <div className="w-24">{r.abovePricePct !== null ? `${r.abovePricePct.toFixed(1)}%` : '—'}</div>
                    <div className="w-24">{r.popPct !== null ? `${r.popPct}%` : '—'}</div>
                    <div data-testid={`cc-all-gap-${r.strike}`} data-tone={gapTone(r) ?? 'none'} className={`w-20 font-bold ${{ green: 'text-emerald-400', yellow: 'text-yellow-300', red: 'text-red-400', none: '' }[gapTone(r) ?? 'none']}`}>{r.gapCents !== null ? `$${(r.gapCents / 100).toFixed(2)}` : '—'}</div>
                    <div className={`w-28 ${r.openInterest === 0 ? 'text-amber-300' : ''}`}>{r.openInterest !== null ? r.openInterest.toLocaleString('en-US') : '—'}</div>
                    <div className="flex flex-1 flex-wrap gap-1.5">
                      {r.isPick && <span className="rounded-full border border-emerald-400 px-2 text-xs font-bold text-emerald-300">{r.strike === balanced ? 'Balanced pick' : 'A pick'}</span>}
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
        <p className="border-t border-neutral-800 pt-2 text-xs text-neutral-400">Every call on this date is listed; click a column to sort. The price gap is green when small, yellow when ok, red when too big. A row gets a chip only when it breaks another rule. Rows with a chip have no order button. A pick opens the normal order screen with the same checks.</p>
      </div>
      {order && <CcTradeModal th={th} order={order} deps={deps.order} onClose={() => setOrder(null)} />}
    </div>
  );
}
