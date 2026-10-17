'use client';
// features/portfolio/positions-workspace/salvage/SalvagePanel.tsx
//
// SALVAGE-0001 slice C -- the Salvage panel, per the mock approved 2026-10-16
// (Diane; Ian, Paul, Quinn sign-off). Read-only: it never places, changes or
// cancels an order. The order proposal is slice D.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Position } from '@/lib/portfolio-data/types';
import { useAutoRefreshPause } from '@/components/portfolio-data/usePortfolioAutoRefresh';
import { loadSalvageChain, type SalvageChain } from '@/lib/salvage/salvageChainClient';
import { salvageEligibility } from '@/lib/salvage/salvageEligibility';
import {
  buildSalvageViewModel,
  type ObjectiveKind,
  type RankBy,
  type SalvageViewModel,
} from './model';

const usd = (n: number, digits = 2) =>
  (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function nyTodayYmd(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

const VERDICT_LABEL = { 'can-meet': 'Can meet', 'partial-only': 'Partial only', 'cannot-meet': 'Cannot meet' } as const;
const VERDICT_CLASS = {
  'can-meet': 'border-emerald-400 bg-emerald-950 text-emerald-200',
  'partial-only': 'border-amber-400 bg-amber-950 text-amber-200',
  'cannot-meet': 'border-red-400 bg-red-950 text-red-200',
} as const;

const pill = (active: boolean) =>
  `min-h-11 rounded-lg border px-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400 ${active ? 'border-emerald-400 bg-emerald-900 text-emerald-50' : 'border-slate-600 bg-slate-950 text-slate-300'}`;

export function SalvageView({
  vm, p, objective, setObjective, amountText, setAmountText, rankBy, setRankBy,
  wingQuantity, setWingQuantity, maxWing, selectedStrike, setSelectedStrike, onRefresh, loading, onClose,
}: {
  vm: SalvageViewModel; p: Position;
  objective: ObjectiveKind; setObjective: (o: ObjectiveKind) => void;
  amountText: string; setAmountText: (s: string) => void;
  rankBy: RankBy; setRankBy: (r: RankBy) => void;
  wingQuantity: number; setWingQuantity: (n: number) => void; maxWing: number;
  selectedStrike: number | null; setSelectedStrike: (n: number) => void;
  onRefresh: () => void; loading: boolean; onClose: () => void;
}) {
  const leg = p.legs[0];
  const right = leg.optionType;
  const sel = vm.selected;
  return (
    <div className="space-y-4 text-slate-200" data-testid="salvage-view">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Salvage · long option</p>
          <h2 className="text-xl font-semibold text-white">{p.symbol} {p.expDate} {leg.strikePrice} {right === 'P' ? 'Put' : 'Call'} × {p.quantity}</h2>
          <p className="text-sm text-slate-400">
            Paid <b className="text-slate-100">{vm.long ? usd(vm.long.entryDebit, 0) : '—'}</b>
            {' · '}Worth about <b className="text-slate-100">{vm.closeNow != null ? usd(vm.closeNow, 0) : '—'}</b>
            {p.stockPrice != null && <> · {p.symbol} <b className="text-slate-100">{usd(p.stockPrice)}</b></>} · {p.dte} DTE
            {leg.currentDelta != null && <> · Delta {leg.currentDelta.toFixed(3)}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onRefresh} disabled={loading} className="min-h-11 rounded-lg border border-slate-600 bg-slate-900 px-3 text-xs disabled:opacity-50">{loading ? 'Loading…' : 'Refresh quotes'}</button>
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-600 bg-slate-900 px-3 text-xs">Close</button>
        </div>
      </header>

      {vm.unavailable ? (
        <div role="alert" className="rounded-xl border border-red-800 bg-red-950/50 p-4" data-testid="salvage-unavailable">
          <p className="font-semibold text-white">Salvage unavailable</p>
          <p className="text-sm text-red-200">{vm.unavailable}</p>
        </div>
      ) : (<>
        {vm.earnings.before && (
          <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200" data-testid="salvage-earnings">
            <b>Earnings {vm.earnings.date}{vm.earnings.daysAway != null ? ` (${vm.earnings.daysAway} days)` : ''}, before expiry.</b>{' '}
            Event volatility impact is not available. Figures use today&apos;s quotes only.
          </div>
        )}
        {(vm.longQuoteStale || vm.longWide) && (
          <div role="alert" className="rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200" data-testid="salvage-long-warning">
            {vm.longQuoteStale ? 'Quotes are more than 60 seconds old. Refresh before relying on these figures.' : 'The market on your option is wide, so Close now may fill below the figure shown.'}
          </div>
        )}

        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4" aria-label="Objective">
          <p className="text-sm font-semibold text-white">What do you want from today?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={pill(objective === 'most')} aria-pressed={objective === 'most'} onClick={() => setObjective('most')}>Most dollars from today</button>
            <button type="button" className={pill(objective === 'amount')} aria-pressed={objective === 'amount'} onClick={() => setObjective('amount')}>Reach a dollar amount</button>
            <button type="button" className={pill(objective === 'debit')} aria-pressed={objective === 'debit'} onClick={() => setObjective('debit')}>Original debit {vm.long ? usd(vm.long.entryDebit, 0) : ''} (sunk-cost check)</button>
          </div>
          <p className="text-xs text-slate-400">The original debit is for reference. It does not change what each choice is worth from here.</p>
          <div className="flex flex-wrap items-end gap-4 border-t border-slate-800 pt-3">
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Rank wings by</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={pill(rankBy === 'most')} aria-pressed={rankBy === 'most'} onClick={() => setRankBy('most')}>Most from today</button>
                <button type="button" className={pill(rankBy === 'credit')} aria-pressed={rankBy === 'credit'} onClick={() => setRankBy('credit')}>Highest credit now</button>
                <button type="button" className={pill(rankBy === 'easiest')} aria-pressed={rankBy === 'easiest'} onClick={() => setRankBy('easiest')}>Easiest price to reach</button>
              </div>
            </div>
            {objective === 'amount' && (
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Dollar amount from today
                <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} className="mt-1 block min-h-11 w-40 rounded-lg border border-slate-600 bg-slate-950 px-3 text-sm font-normal normal-case tracking-normal text-white" />
              </label>
            )}
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Wing contracts
              <select value={wingQuantity} onChange={(e) => setWingQuantity(parseInt(e.target.value, 10))} className="mt-1 block min-h-11 w-28 rounded-lg border border-slate-600 bg-slate-950 px-3 text-sm font-normal normal-case tracking-normal text-white">
                {Array.from({ length: maxWing }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n} of {maxWing}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section aria-label="Your three choices" className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">Close now</p>
            <p className="text-2xl font-semibold text-white" data-testid="salvage-close">{vm.closeNow != null ? usd(vm.closeNow) : '—'}</p>
            <p className="text-xs text-slate-300">Cash today at the bid, after about {usd(0.14 * p.quantity)} in fees. Nothing further.</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">Hold</p>
            <p className="text-2xl font-semibold text-white">{vm.scenarios[0] ? usd(vm.scenarios[0].hold, 0) : '—'} <span className="text-sm font-normal text-slate-400">unless {p.symbol} {right === 'P' ? '≤' : '≥'} {usd(leg.strikePrice, 0)}</span></p>
            <p className="text-xs text-slate-300">Payoff at expiry only. Time value left in the option is not counted.</p>
          </div>
          <div className="rounded-xl border border-emerald-500 bg-slate-900 p-4">
            <p className="text-xs text-emerald-300">Sell the wing{sel ? ` (${sel.strike} ${right === 'P' ? 'put' : 'call'} shown)` : ''}</p>
            <p className="text-2xl font-semibold text-white" data-testid="salvage-wing-credit">{sel ? `+${usd(sel.creditNet)}` : '—'} <span className="text-sm font-normal text-slate-400">now</span></p>
            <p className="text-xs text-slate-300">{sel ? `Keep your ${leg.strikePrice} ${right === 'P' ? 'put' : 'call'}, sell a ${right === 'P' ? 'lower' : 'higher'} one. Adds at most ${usd(Math.abs(leg.strikePrice - sel.strike) * 100 * wingQuantity, 0)} at expiry, plus the cash now.` : 'No wing clears its fees.'}</p>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4" aria-label="Wing candidates">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-white">Wing candidates (same expiry, strictly {right === 'P' ? 'below' : 'above'} {leg.strikePrice})</p>
            <p className="text-xs text-slate-400">Credits use the bid. Fees are estimates.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead><tr className="text-right text-[11px] uppercase tracking-wider text-slate-400">
                <th className="px-2 py-2 text-left">Short {right === 'P' ? 'put' : 'call'}</th><th className="px-2 py-2">Credit now</th><th className="px-2 py-2">Most from today</th><th className="px-2 py-2">Short delta</th><th className="px-2 py-2">{p.symbol} needed for {usd(vm.target, 0)}</th><th className="px-2 py-2 text-left">Against {usd(vm.target, 0)}</th><th className="px-2 py-2 text-left">Notes</th>
              </tr></thead>
              <tbody>
                {vm.rows.length === 0 && <tr><td colSpan={7} className="px-2 py-4 text-slate-400">No wing clears its fees on this chain.</td></tr>}
                {vm.rows.map((r) => {
                  const active = sel?.strike === r.strike;
                  const req = r.objective?.required;
                  return (
                    <tr key={r.strike} className={`border-t ${active ? 'border-emerald-500 bg-emerald-950/40' : 'border-slate-800'} text-right`} data-testid={`salvage-row-${r.strike}`}>
                      <td className="px-2 py-2 text-left"><button type="button" aria-pressed={active} onClick={() => setSelectedStrike(r.strike)} className="min-h-11 font-semibold text-white underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-teal-400">{r.strike}</button>{active && <span className="ml-1 text-xs text-emerald-300">selected</span>}</td>
                      <td className="px-2 py-2">{usd(r.creditNet)}</td>
                      <td className="px-2 py-2">{Number.isFinite(r.maxFromToday) ? usd(r.maxFromToday) : 'Unlimited'}</td>
                      <td className="px-2 py-2">{r.delta != null ? r.delta.toFixed(2) : '—'}</td>
                      <td className="px-2 py-2">{req == null ? <span className="text-slate-400">Not reachable</span> : 'already' in req ? 'Met by the credit' : `${right === 'P' ? '≤' : '≥'} ${usd(req.price)}`}</td>
                      <td className="px-2 py-2 text-left">{r.objective && <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs ${VERDICT_CLASS[r.objective.verdict]}`}>{VERDICT_LABEL[r.objective.verdict]}</span>}</td>
                      <td className="px-2 py-2 text-left text-xs text-amber-300">{r.warnings.map((w) => (w === 'WIDE_MARKET' ? 'Wide market' : 'Stale quote')).join(' · ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sel && (
            <div className="space-y-1 border-t border-slate-800 pt-3 text-sm" data-testid="salvage-gives-up">
              <p><b>What the {sel.strike} wing gives up:</b> {right === 'P' ? 'below' : 'above'} {usd(sel.strike, 0)} the long {right === 'P' ? 'put' : 'call'} stops adding value, so it adds at most {usd(Math.abs(leg.strikePrice - sel.strike) * 100 * wingQuantity, 0)}. The short {right === 'P' ? 'put' : 'call'} can be assigned early; your long {right === 'P' ? 'put' : 'call'} covers it.</p>
              <p className="text-slate-400">Selling the wing does not make the option more likely to finish in the money. It turns part of its future value into cash today.</p>
            </div>
          )}
        </section>

        {sel && vm.scenarios.length > 0 && (
          <section className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-4" aria-label="Scenarios">
            <p className="text-sm font-semibold text-white">Dollars from today if {p.symbol} finishes at…</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead><tr className="text-right text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="px-2 py-2 text-left">&nbsp;</th>
                  {vm.scenarios.map((s) => <th key={s.label} className="px-2 py-2">{usd(s.price)}<br /><span className="normal-case tracking-normal">{s.label}</span></th>)}
                </tr></thead>
                <tbody>
                  <tr className="border-t border-slate-800 text-right"><td className="px-2 py-2 text-left font-semibold">Close now</td>{vm.scenarios.map((s) => <td key={s.label} className="px-2 py-2">{vm.closeNow != null ? usd(vm.closeNow) : '—'}</td>)}</tr>
                  <tr className="border-t border-slate-800 text-right"><td className="px-2 py-2 text-left font-semibold">Hold (at expiry)</td>{vm.scenarios.map((s) => <td key={s.label} className="px-2 py-2">{usd(s.hold)}</td>)}</tr>
                  <tr className="border-t border-slate-800 bg-emerald-950/40 text-right"><td className="px-2 py-2 text-left font-bold">Wing {sel.strike}</td>{vm.scenarios.map((s) => <td key={s.label} className="px-2 py-2">{s.wing != null ? usd(s.wing) : '—'}</td>)}</tr>
                  <tr className="border-t border-slate-800 text-right text-slate-400"><td className="px-2 py-2 text-left">Wing {sel.strike} vs the {vm.long ? usd(vm.long.entryDebit, 0) : ''} paid</td>{vm.scenarios.map((s) => <td key={s.label} className="px-2 py-2">{s.wingVsPaid != null ? `${s.wingVsPaid >= 0 ? '+' : '−'}$${Math.abs(Math.round(s.wingVsPaid)).toLocaleString('en-US')}` : '—'}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400">Holding can pay more than the wing if {p.symbol} falls a long way; that is the trade-off.</p>
          </section>
        )}
        <p className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm text-slate-300">Proposal only. Salvage never places, changes or cancels an order. Order review arrives in the next release.</p>
      </>)}
    </div>
  );
}

/** Row-level entry: renders nothing unless the position is eligible. */
export function SalvageEntry({ position }: { position: Position }) {
  const eligibility = useMemo(() => salvageEligibility(position), [position]);
  const [open, setOpen] = useState(false);
  if (!eligibility.eligible) return null;
  return (
    <span className="mt-1 block">
      <button type="button" onClick={() => setOpen(true)} data-testid="salvage-open" className="min-h-11 rounded border border-emerald-500/60 px-2 text-[11px] font-bold text-emerald-200 hover:bg-emerald-950 focus:outline-none focus:ring-2 focus:ring-teal-400">Salvage</button>
      {open && <SalvageDialog position={position} onClose={() => setOpen(false)} />}
    </span>
  );
}

function SalvageDialog({ position, onClose }: { position: Position; onClose: () => void }) {
  useAutoRefreshPause(true);
  const eligibility = salvageEligibility(position);
  const [chain, setChain] = useState<SalvageChain | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [objective, setObjective] = useState<ObjectiveKind>('most');
  const [amountText, setAmountText] = useState('');
  const [rankBy, setRankBy] = useState<RankBy>('most');
  const [wingQuantity, setWingQuantity] = useState(1);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!eligibility.eligible) return;
    setLoading(true); setError(null);
    try {
      const c = await loadSalvageChain(position.symbol, eligibility.expDate, eligibility.right, '');
      setChain(c); setNowMs(Date.now());
    } catch (e: any) {
      setChain(null); setError(e?.message ?? 'The option chain did not load.');
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.symbol]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!eligibility.eligible) return null;
  const amount = parseFloat(amountText.replace(/[$,]/g, ''));
  const vm = buildSalvageViewModel({
    eligible: eligibility, position, quotes: chain?.quotes ?? null, nowMs, todayYmd: nyTodayYmd(),
    objective, amount: Number.isFinite(amount) ? amount : null, rankBy, wingQuantity, selectedStrike,
  });
  const shown: SalvageViewModel = error ? { ...vm, unavailable: error } : loading && !chain ? { ...vm, unavailable: 'Loading the option chain…' } : vm;
  if (typeof document === 'undefined') return null;
  // Portal to <body>: rendered inside a table row, the page's sticky headers (z-30/z-40) stack over the dialog.
  return createPortal(
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={`Salvage ${position.symbol}`}>
      <div className="mx-auto max-w-5xl rounded-2xl border border-slate-700 bg-slate-950 p-5">
        <SalvageView
          vm={shown} p={position} objective={objective} setObjective={setObjective}
          amountText={amountText} setAmountText={setAmountText} rankBy={rankBy} setRankBy={setRankBy}
          wingQuantity={wingQuantity} setWingQuantity={setWingQuantity} maxWing={eligibility.quantity}
          selectedStrike={selectedStrike} setSelectedStrike={setSelectedStrike}
          onRefresh={() => void load()} loading={loading} onClose={onClose}
        />
      </div>
    </div>,
    document.body,
  );
}
