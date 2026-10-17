'use client';
// features/portfolio/positions-workspace/salvage/SalvagePanel.tsx
//
// SALVAGE-0001 slice C -- the Salvage panel, per the mock approved 2026-10-16
// (Diane; Ian, Paul, Quinn sign-off). Read-only: it never places, changes or
// cancels an order. The order proposal is slice D.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Position } from '@/lib/portfolio-data/types';
import { useAutoRefreshPause } from '@/components/portfolio-data/usePortfolioAutoRefresh';
import { loadSalvageChain, type SalvageChain } from '@/lib/salvage/salvageChainClient';
import { buildWingRows } from '@/lib/salvage/salvageCandidates';
import { salvageEligibility } from '@/lib/salvage/salvageEligibility';
import { useSalvageDeps } from './SalvageDeps';
import { SalvageReview } from './SalvageReview';
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
  wingQuantity, setWingQuantity, maxWing, selectedStrike, setSelectedStrike, onRefresh, loading, onClose, onReview, reviewBlockedReason,
}: {
  vm: SalvageViewModel; p: Position;
  objective: ObjectiveKind; setObjective: (o: ObjectiveKind) => void;
  amountText: string; setAmountText: (s: string) => void;
  rankBy: RankBy; setRankBy: (r: RankBy) => void;
  wingQuantity: number; setWingQuantity: (n: number) => void; maxWing: number;
  selectedStrike: number | null; setSelectedStrike: (n: number) => void;
  onRefresh: () => void; loading: boolean; onClose: () => void;
  onReview?: () => void; reviewBlockedReason?: string | null;
}) {
  const leg = p.legs[0];
  const right = leg.optionType;
  const sel = vm.selected;
  // The wing table scrolls inside its own box: keep the selected row in view there (never scrolls the page).
  const tableBox = useRef<HTMLDivElement>(null);
  const selStrike = sel?.strike;
  useEffect(() => {
    const box = tableBox.current;
    if (!box || selStrike == null) return;
    const row = box.querySelector<HTMLElement>(`[data-testid="salvage-row-${selStrike}"]`);
    if (!row) return;
    const top = row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2;
    box.scrollTop = Math.max(0, top);
  }, [selStrike, vm.rows.length]);
  const req = sel?.objective?.required;
  const capPerShare = sel ? Math.abs(leg.strikePrice - sel.strike) * 100 * wingQuantity : 0;
  const targetLabel = objective === 'amount' ? usd(vm.target, 0) : `the ${usd(vm.target, 0)} you paid`;
  const word = right === 'P' ? 'put' : 'call';
  const scenarioBoxes = (() => {
    const sc = vm.scenarios;
    const pick = (kind: string) => sc.find((x) => x.kind === kind);
    return [pick('now'), pick('target') ?? pick('wing'), pick('deep')].filter((x, i, a): x is NonNullable<typeof x> => !!x && a.indexOf(x) === i);
  })();
  return (
    <div className="flex flex-col gap-3 text-slate-200" data-testid="salvage-view">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Salvage · long option</p>
          <h2 className="text-lg font-semibold text-white">{p.symbol} {p.expDate} {leg.strikePrice} {right === 'P' ? 'Put' : 'Call'} × {p.quantity}</h2>
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
        {(vm.earnings.before || vm.longQuoteStale || vm.longWide) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {vm.earnings.before && (
              <div className="min-w-0 flex-1 rounded-lg border border-amber-700 bg-amber-950/40 px-3 py-2 text-amber-200" data-testid="salvage-earnings">
                <b>Earnings {vm.earnings.date}{vm.earnings.daysAway != null ? ` (${vm.earnings.daysAway} days)` : ''}, before expiry.</b> Event volatility impact is not available.
              </div>
            )}
            {(vm.longQuoteStale || vm.longWide) && (
              <div role="alert" className="min-w-0 flex-1 rounded-lg border border-amber-700 bg-amber-950/40 px-3 py-2 text-amber-200" data-testid="salvage-long-warning">
                {vm.longQuoteStale ? 'Quotes are more than 60 seconds old. Refresh before relying on these figures.' : 'The market on your option is wide, so Close now may fill below the figure shown.'}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-3" aria-label="Objective">
            <p className="text-sm font-semibold text-white">What do you want from today?</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={pill(objective === 'most')} aria-pressed={objective === 'most'} onClick={() => setObjective('most')}>Most dollars</button>
              <button type="button" className={pill(objective === 'amount')} aria-pressed={objective === 'amount'} onClick={() => setObjective('amount')}>A dollar amount</button>
              <button type="button" className={pill(objective === 'debit')} aria-pressed={objective === 'debit'} onClick={() => setObjective('debit')}>Original debit {vm.long ? usd(vm.long.entryDebit, 0) : ''}</button>
            </div>
            <div className="flex flex-wrap items-end gap-3 border-t border-slate-800 pt-2">
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
                  <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} className="mt-1 block min-h-11 w-36 rounded-lg border border-slate-600 bg-slate-950 px-3 text-sm font-normal normal-case tracking-normal text-white" />
                </label>
              )}
              {maxWing > 1 && (
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Wing contracts
                  <select value={wingQuantity} onChange={(e) => setWingQuantity(parseInt(e.target.value, 10))} className="mt-1 block min-h-11 w-24 rounded-lg border border-slate-600 bg-slate-950 px-3 text-sm font-normal normal-case tracking-normal text-white">
                    {Array.from({ length: maxWing }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n} of {maxWing}</option>)}
                  </select>
                </label>
              )}
            </div>
            <p className="text-xs text-slate-400">Original debit is a sunk-cost check only. It does not change what each choice is worth from here.</p>
          </section>

          <div className="flex flex-col gap-3">
            <section className="space-y-1 rounded-xl border border-emerald-700 bg-emerald-950/30 p-3 text-sm" aria-label="In plain words" data-testid="salvage-bottom-line">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">In plain words</p>
              <p>Closing now puts about <b>{vm.closeNow != null ? usd(vm.closeNow) : '—'}</b> in your pocket, the most cash it can give you today.</p>
              {sel && <p>Selling the {sel.strike} {word} against it (a &quot;wing&quot;) adds only about <b>{usd(sel.creditNet)}</b> now and gives up what the option could pay beyond {usd(sel.strike, 0)}.</p>}
              {sel && (req && 'price' in req && p.stockPrice
                ? <p>To get back {targetLabel}, {p.symbol} would have to finish at or {right === 'P' ? 'below' : 'above'} <b>{usd(req.price)}</b> by {p.expDate}, about {Math.round(Math.abs(p.stockPrice - req.price) / p.stockPrice * 100)}% {right === 'P' ? 'below' : 'above'} today&apos;s {usd(p.stockPrice)}.</p>
                : req && 'already' in req ? <p>The cash from this wing already covers {targetLabel}.</p>
                : <p>No {word} on this chain can get back {targetLabel}.</p>)}
            </section>
            <section aria-label="Your three choices" className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                <p className="text-xs text-slate-400">Close now</p>
                <p className="text-xl font-semibold text-white" data-testid="salvage-close">{vm.closeNow != null ? usd(vm.closeNow) : '—'}</p>
                <p className="text-[11px] text-slate-400">Cash today, after about {usd(0.14 * p.quantity)} fees. Done.</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                <p className="text-xs text-slate-400">Keep it</p>
                <p className="text-xl font-semibold text-white">{vm.scenarios[0] ? usd(vm.scenarios[0].hold, 0) : '—'}</p>
                <p className="text-[11px] text-slate-400">Unless {p.symbol} {right === 'P' ? '≤' : '≥'} {usd(leg.strikePrice, 0)} at expiry.</p>
              </div>
              <div className="rounded-xl border border-emerald-500 bg-slate-900 p-3">
                <p className="text-xs text-emerald-300">Sell the wing{sel ? ` (${sel.strike})` : ''}</p>
                <p className="text-xl font-semibold text-white" data-testid="salvage-wing-credit">{sel ? `+${usd(sel.creditNet)}` : '—'}</p>
                <p className="text-[11px] text-slate-400">{sel ? `Cash now. Adds at most ${usd(capPerShare, 0)} at expiry.` : 'No wing clears its fees.'}</p>
              </div>
            </section>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <section className="flex min-h-0 flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3" aria-label="Wing candidates">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-white">Pick a wing: {word}s {right === 'P' ? 'below' : 'above'} {leg.strikePrice}</p>
              <p className="text-xs text-slate-400">Click a row. Credits use the bid; fees are estimates.</p>
            </div>
            <div ref={tableBox} className="relative max-h-48 overflow-auto rounded-lg border border-slate-800">
              <table className="w-full min-w-[520px] border-collapse text-[13px]">
                <thead className="sticky top-0 bg-slate-900"><tr className="text-right text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="px-2 py-1.5 text-left">Short {word}</th><th className="px-2 py-1.5">Credit now</th><th className="px-2 py-1.5">Most from today</th><th className="px-2 py-1.5">{p.symbol} needed</th><th className="px-2 py-1.5 text-left">Target</th>
                </tr></thead>
                <tbody>
                  {vm.rows.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-slate-400">No wing clears its fees on this chain.</td></tr>}
                  {vm.rows.map((r) => {
                    const active = sel?.strike === r.strike;
                    const rq = r.objective?.required;
                    return (
                      <tr key={r.strike} className={`cursor-pointer border-t ${active ? 'border-emerald-500 bg-emerald-950/40' : 'border-slate-800 hover:bg-slate-800/50'} text-right`} onClick={() => setSelectedStrike(r.strike)} data-testid={`salvage-row-${r.strike}`}>
                        <td className="px-2 py-1 text-left"><button type="button" aria-pressed={active} aria-label={`${active ? 'Selected' : 'Select'} the ${r.strike} ${word}`} className={`min-h-8 min-w-16 rounded-md border px-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-400 ${active ? 'border-emerald-400 bg-emerald-900 text-emerald-50' : 'border-slate-500 bg-slate-950 text-white hover:border-emerald-400'}`}>{r.strike}{active ? ' ✓' : ''}</button>{r.warnings.length > 0 && <span className="ml-2 text-[11px] text-amber-300" title={r.warnings.map((w) => (w === 'WIDE_MARKET' ? 'Wide market' : 'Stale quote')).join(' · ')}>{r.warnings.map((w) => (w === 'WIDE_MARKET' ? 'Wide' : 'Stale')).join(' · ')}</span>}</td>
                        <td className="px-2 py-1">{usd(r.creditNet)}</td>
                        <td className="px-2 py-1">{Number.isFinite(r.maxFromToday) ? usd(r.maxFromToday) : 'Unlimited'}</td>
                        <td className="px-2 py-1">{rq == null ? <span className="text-slate-400">Not reachable</span> : 'already' in rq ? 'Met by credit' : `${right === 'P' ? '≤' : '≥'} ${usd(rq.price)}`}</td>
                        <td className="px-2 py-1 text-left">{r.objective && <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${VERDICT_CLASS[r.objective.verdict]}`}>{VERDICT_LABEL[r.objective.verdict]}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {sel && (
              <p className="text-xs text-slate-300" data-testid="salvage-gives-up">
                <b>What the {sel.strike} wing gives up:</b> {right === 'P' ? 'below' : 'above'} {usd(sel.strike, 0)} the long {word} stops adding value, so it adds at most {usd(capPerShare, 0)}. The short {word} can be assigned early; your long {word} covers it.
              </p>
            )}
            <details className="text-xs text-slate-400">
              <summary className="min-h-9 cursor-pointer py-2 text-slate-300">How to read this table</summary>
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2" data-testid="salvage-legend">
                <div><dt className="inline font-semibold text-slate-300">Credit now: </dt><dd className="inline">cash you receive today for selling that {word}, after fees.</dd></div>
                <div><dt className="inline font-semibold text-slate-300">Most from today: </dt><dd className="inline">the most you could ever get from here (cash now plus the best payoff at expiry).</dd></div>
                <div><dt className="inline font-semibold text-slate-300">{p.symbol} needed: </dt><dd className="inline">where {p.symbol} must finish at expiry for you to reach the target.</dd></div>
                <div><dt className="inline font-semibold text-slate-300">Can meet / Partial only: </dt><dd className="inline">whether that is possible at all with this wing.</dd></div>
                <div><dt className="inline font-semibold text-slate-300">Remember: </dt><dd className="inline">selling a wing does not make the option more likely to pay. It turns part of its future value into cash today.</dd></div>
              </dl>
            </details>
          </section>

          {sel && vm.scenarios.length > 0 && (
            <section className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3" aria-label="Scenarios">
              <p className="text-sm font-semibold text-white">Three ways it could go (total dollars from today; ✓ = best)</p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead><tr className="text-right text-[11px] uppercase tracking-wider text-slate-400">
                    <th className="px-1 py-1 text-left">If {p.symbol} finishes…</th><th className="px-1 py-1">Close now</th><th className="px-1 py-1">Keep it</th><th className="px-1 py-1">Wing {sel.strike}</th><th className="px-1 py-1">Best vs paid</th>
                  </tr></thead>
                  <tbody data-testid="salvage-simple-scenarios">
                    {scenarioBoxes.map((x) => {
                      const title = x.kind === 'now' ? `Here (${usd(x.price)})`
                        : x.kind === 'target' ? `${usd(x.price)}: gets back ${objective === 'amount' ? `your ${usd(vm.target, 0)}` : `the ${usd(vm.target, 0)} you paid`}`
                        : x.kind === 'wing' ? `${usd(x.price, 0)}: the wing strike`
                        : `${usd(x.price)} (${x.label}): well past the wing`;
                      const vals = [vm.closeNow ?? 0, x.hold, x.wing ?? 0];
                      const best = Math.max(...vals);
                      const vsPaid = vm.long ? Math.round(best - vm.long.entryDebit) : 0;
                      return (
                        <tr key={`${x.kind}-${x.price}`} className="border-t border-slate-800 text-right align-top">
                          <td className="px-1 py-1.5 text-left text-slate-200">{title}</td>
                          {vals.map((v, k) => <td key={k} className={`px-1 py-1.5 ${v === best ? 'font-bold text-emerald-300' : 'text-slate-300'} whitespace-nowrap`}>{usd(v)}{v === best ? ' ✓' : ''}</td>)}
                          <td className={`px-1 py-1.5 ${vsPaid < 0 ? 'text-slate-400' : 'text-emerald-300'}`}>{vsPaid >= 0 ? '+' : '−'}${Math.abs(vsPaid).toLocaleString('en-US')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <details className="text-xs text-slate-400">
                <summary className="min-h-9 cursor-pointer py-2 text-slate-300">Show every price</summary>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] border-collapse text-[13px]">
                    <thead><tr className="text-right text-[11px] uppercase tracking-wider text-slate-400">
                      <th className="px-2 py-1 text-left">&nbsp;</th>
                      {vm.scenarios.map((s) => <th key={`${s.kind}-${s.price}`} className="px-2 py-1">{usd(s.price)}<br /><span className="normal-case tracking-normal">{s.label}</span></th>)}
                    </tr></thead>
                    <tbody>
                      <tr className="border-t border-slate-800 text-right"><td className="px-2 py-1 text-left font-semibold">Close now</td>{vm.scenarios.map((s) => <td key={`${s.kind}-${s.price}`} className="px-2 py-1">{vm.closeNow != null ? usd(vm.closeNow) : '—'}</td>)}</tr>
                      <tr className="border-t border-slate-800 text-right"><td className="px-2 py-1 text-left font-semibold">Do nothing, keep it to expiry</td>{vm.scenarios.map((s) => <td key={`${s.kind}-${s.price}`} className="px-2 py-1">{usd(s.hold)}</td>)}</tr>
                      <tr className="border-t border-slate-800 bg-emerald-950/40 text-right"><td className="px-2 py-1 text-left font-bold">Wing {sel.strike}</td>{vm.scenarios.map((s) => <td key={`${s.kind}-${s.price}`} className="px-2 py-1">{s.wing != null ? usd(s.wing) : '—'}</td>)}</tr>
                      <tr className="border-t border-slate-800 text-right text-slate-400"><td className="px-2 py-1 text-left">Wing {sel.strike} vs the {vm.long ? usd(vm.long.entryDebit, 0) : ''} paid</td>{vm.scenarios.map((s) => <td key={`${s.kind}-${s.price}`} className="px-2 py-1">{s.wingVsPaid != null ? `${s.wingVsPaid >= 0 ? '+' : '−'}$${Math.abs(Math.round(s.wingVsPaid)).toLocaleString('en-US')}` : '—'}</td>)}</tr>
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          )}
        </div>

        <section className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-950/95 px-3 py-2 backdrop-blur" aria-label="Order">
          <p className="max-w-xl text-xs text-slate-400">Proposal only. You review the order, run a broker dry run, and press Submit yourself. Salvage never places, changes or cancels an order on its own.</p>
          <div className="flex flex-col items-end gap-1">
            <button type="button" onClick={onReview} disabled={!onReview || !!reviewBlockedReason || !sel} data-testid="salvage-review-open" className="min-h-11 rounded-lg bg-emerald-500 px-4 text-sm font-bold text-emerald-950 focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-40">{sel ? `Review order: sell ${wingQuantity} ${p.symbol} ${sel.strike} ${word}` : 'Review order'}</button>
            {(reviewBlockedReason || !onReview) && <p className="text-xs text-amber-300" data-testid="salvage-review-blocked">{reviewBlockedReason ?? 'Order review is not available here.'}</p>}
          </div>
        </section>
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
  const deps = useSalvageDeps();
  const [reviewing, setReviewing] = useState(false);

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
  const sel = vm.selected;
  const reviewBlockedReason = !deps
    ? 'Order review is not available here.'
    : !sel ? 'Select a wing first.'
    : !sel.occSymbol ? 'The option symbol is missing, so an order cannot be built.'
    : vm.longQuoteStale || !sel.proposable ? 'Quotes are more than 60 seconds old. Refresh quotes first.'
    : loading ? 'Loading quotes…' : null;
  const reload = async () => {
    const c = await loadSalvageChain(position.symbol, eligibility.expDate, eligibility.right, '');
    setChain(c); setNowMs(Date.now());
    const wingQ = Math.max(1, Math.min(eligibility.quantity, Math.floor(wingQuantity) || 1));
    const own = c.quotes.find((x) => x.right === eligibility.right && x.strike === eligibility.strike);
    if (!own || own.bid == null) return { row: null, tickTable: c.tickTable };
    const rows = buildWingRows(c.quotes, {
      long: { right: eligibility.right, strike: eligibility.strike, quantity: eligibility.quantity, bid: own.bid, entryDebit: eligibility.entryDebit },
      wingQuantity: wingQ, nowMs: Date.now(),
    });
    return { row: rows.find((r) => r.strike === sel?.strike) ?? null, tickTable: c.tickTable };
  };
  const req = sel?.objective?.required;
  const objectiveLine = !sel ? '' : (() => {
    const label = objective === 'amount' ? usd(vm.target, 0) : `Original debit ${usd(vm.target, 0)}`;
    if (req && 'price' in req) return `${label}: can meet only if ${position.symbol} finishes at or ${eligibility.right === 'P' ? 'below' : 'above'} ${usd(req.price)}.`;
    if (req && 'already' in req) return `${label}: already covered by the credit.`;
    return `${label}: cannot be reached with this wing.`;
  })();
  const shown: SalvageViewModel = error ? { ...vm, unavailable: error } : loading && !chain ? { ...vm, unavailable: 'Loading the option chain…' } : vm;
  if (typeof document === 'undefined') return null;
  // Portal to <body>: rendered inside a table row, the page's sticky headers (z-30/z-40) stack over the dialog.
  return createPortal(
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-black/80 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={`Salvage ${position.symbol}`}>
      <div className="mx-auto max-w-6xl rounded-2xl border border-slate-700 bg-slate-950 p-4">
        {reviewing && deps && sel && sel.occSymbol ? (
          <SalvageReview
            position={position} eligible={eligibility} row={sel}
            wingQuantity={Math.max(1, Math.min(eligibility.quantity, Math.floor(wingQuantity) || 1))}
            tickTable={chain?.tickTable ?? null} objectiveLine={objectiveLine} earnings={vm.earnings}
            deps={deps} reload={reload} onBack={() => setReviewing(false)} onClose={onClose}
          />
        ) : (
        <SalvageView
          vm={shown} p={position} objective={objective} setObjective={setObjective}
          amountText={amountText} setAmountText={setAmountText} rankBy={rankBy} setRankBy={setRankBy}
          wingQuantity={wingQuantity} setWingQuantity={setWingQuantity} maxWing={eligibility.quantity}
          selectedStrike={selectedStrike} setSelectedStrike={setSelectedStrike}
          onRefresh={() => void load()} loading={loading} onClose={onClose}
          onReview={deps ? () => setReviewing(true) : undefined} reviewBlockedReason={reviewBlockedReason}
        />
        )}
      </div>
    </div>,
    document.body,
  );
}
