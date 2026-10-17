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
  vm, p, objective, setObjective, amountText, setAmountText,
  wingQuantity, setWingQuantity, maxWing, selectedStrike, setSelectedStrike, onRefresh, loading, onClose, onReview, reviewBlockedReason,
}: {
  vm: SalvageViewModel; p: Position;
  objective: ObjectiveKind; setObjective: (o: ObjectiveKind) => void;
  amountText: string; setAmountText: (s: string) => void;
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
  const farWord = right === 'P' ? 'lower' : 'higher';
  const moves = right === 'P' ? 'falls to' : 'rises to';
  const perDollar = 100 * p.quantity;
  const hold0 = vm.scenarios[0] ? vm.scenarios[0].hold : 0;
  const scenarioBoxes = (() => {
    const sc = vm.scenarios;
    const pick = (kind: string) => sc.find((x) => x.kind === kind);
    return [pick('now'), pick('target') ?? pick('wing'), pick('deep')].filter((x, i, a): x is NonNullable<typeof x> => !!x && a.indexOf(x) === i);
  })();
  const amountOf = (v: number, best: boolean) => (
    <>
      <b className={best ? 'text-emerald-300' : 'text-slate-100'}>{usd(v)}</b>
      {best && <span className="text-[11px] text-emerald-300"> (most)</span>}
    </>
  );
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

        <section aria-label="Your two main choices" className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Close now</p>
            <p className="text-3xl font-semibold text-white" data-testid="salvage-close">{vm.closeNow != null ? usd(vm.closeNow) : '—'}</p>
            <p className="mt-1 text-sm text-slate-300">This is your cash today, at the bid, after about {usd(0.14 * p.quantity)} in fees. Nothing more to manage.</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4" data-testid="salvage-hold">
            <p className="text-sm text-slate-400">Hold</p>
            <p className="text-3xl font-semibold text-white">
              {usd(hold0, 0)}{' '}
              <span className="text-sm font-normal text-slate-400">{hold0 > 0 ? `at expiry if ${p.symbol} stays here` : `at expiry unless ${p.symbol} ${right === 'P' ? '≤' : '≥'} ${usd(leg.strikePrice, 0)}`}</span>
            </p>
            <p className="mt-1 text-sm text-slate-300">
              Most you can lose from here: the {vm.closeNow != null ? usd(vm.closeNow, 0) : 'value'} left in it. Most of that is time value, which fades to zero by {p.expDate} if {p.symbol} stays {right === 'P' ? 'above' : 'below'} {usd(leg.strikePrice, 0)}.
              {' '}If {p.symbol} {right === 'P' ? 'falls' : 'rises'}, it pays {usd(perDollar, 0)} for every $1 {right === 'P' ? 'below' : 'above'} {usd(leg.strikePrice, 0)}.
            </p>
          </div>
        </section>

        <details className="rounded-xl border border-slate-800 bg-slate-900 p-3" data-testid="salvage-wing-section">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-white">
            <span>Optional: sell a {farWord} {word} to bank a little cash</span>
            <span className="text-xs font-normal text-slate-400">Most people skip this ▾</span>
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            <p className="text-xs text-slate-400">
              Keep your {leg.strikePrice} {word} and sell a cheaper, {farWord} {word} (a &quot;wing&quot;). You get cash now and give up the payoff {right === 'P' ? 'below' : 'above'} that strike. It does not make the option more likely to pay.
            </p>
            <div className="grid items-start gap-3 lg:grid-cols-2">
              <div className="flex flex-col gap-2">
                <p className="text-xs text-slate-400">Pick the {farWord} {word} (click a row)</p>
                <div ref={tableBox} className="relative max-h-48 overflow-auto rounded-lg border border-slate-800">
                  <table className="w-full border-collapse text-[13px]">
                    <thead className="sticky top-0 bg-slate-900"><tr className="text-right text-[11px] uppercase tracking-wider text-slate-400">
                      <th className="px-2 py-1.5 text-left">Sell this {word}</th><th className="px-2 py-1.5">Cash now</th><th className="px-2 py-1.5">Most it can pay</th>
                    </tr></thead>
                    <tbody>
                      {vm.rows.length === 0 && <tr><td colSpan={3} className="px-2 py-4 text-slate-400">No wing clears its fees on this chain.</td></tr>}
                      {vm.rows.map((r) => {
                        const active = sel?.strike === r.strike;
                        return (
                          <tr key={r.strike} className={`cursor-pointer border-t ${active ? 'border-emerald-500 bg-emerald-950/40' : 'border-slate-800 hover:bg-slate-800/50'} text-right`} onClick={() => setSelectedStrike(r.strike)} data-testid={`salvage-row-${r.strike}`}>
                            <td className="px-2 py-1 text-left"><button type="button" aria-pressed={active} aria-label={`${active ? 'Selected' : 'Select'} the ${r.strike} ${word}`} className={`min-h-8 min-w-16 rounded-md border px-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-400 ${active ? 'border-emerald-400 bg-emerald-900 text-emerald-50' : 'border-slate-500 bg-slate-950 text-white hover:border-emerald-400'}`}>{r.strike}{active ? ' ✓' : ''}</button>{r.warnings.length > 0 && <span className="ml-2 text-[11px] text-amber-300" title={r.warnings.map((w) => (w === 'WIDE_MARKET' ? 'Wide market' : 'Stale quote')).join(' · ')}>{r.warnings.map((w) => (w === 'WIDE_MARKET' ? 'Wide' : 'Stale')).join(' · ')}</span>}</td>
                            <td className="px-2 py-1" data-testid={active ? 'salvage-wing-credit' : undefined}>{usd(r.creditNet)}</td>
                            <td className="px-2 py-1">{Number.isFinite(r.maxFromToday) ? usd(r.maxFromToday) : 'Unlimited'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-400">Farther from your strike: less cash now, more kept if {p.symbol} moves a lot. Closer: more cash now, less kept. Credits use the bid; fees are estimates.</p>
                {sel && (
                  <p className="text-xs text-slate-300" data-testid="salvage-gives-up">
                    <b>What the {sel.strike} wing gives up:</b> {right === 'P' ? 'below' : 'above'} {usd(sel.strike, 0)} the long {word} stops adding value, so it adds at most {usd(capPerShare, 0)}. The short {word} can be assigned early; your long {word} covers it.
                  </p>
                )}
                {maxWing > 1 && (
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Wing contracts
                    <select value={wingQuantity} onChange={(e) => setWingQuantity(parseInt(e.target.value, 10))} className="mt-1 block min-h-11 w-24 rounded-lg border border-slate-600 bg-slate-950 px-3 text-sm font-normal normal-case tracking-normal text-white">
                      {Array.from({ length: maxWing }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n} of {maxWing}</option>)}
                    </select>
                  </label>
                )}
              </div>

              <div className="flex flex-col gap-1">
                {sel && vm.scenarios.length > 0 && (<>
                  <p className="text-xs text-slate-400">What the {sel.strike} {word} does for you, in dollars from today</p>
                  <div data-testid="salvage-simple-scenarios" className="flex flex-col text-sm leading-snug">
                    {scenarioBoxes.map((x) => {
                      const close = vm.closeNow ?? 0;
                      const keep = x.hold;
                      const wing = x.wing ?? 0;
                      const best = Math.max(close, keep, wing);
                      const lead = x.kind === 'now' ? `${p.symbol} stays near ${usd(x.price)}` : `${p.symbol} ${moves} ${usd(x.price)}`;
                      return (
                        <p key={`${x.kind}-${x.price}`} className="border-t border-slate-800 py-2 first:border-t-0">
                          <b className="text-white">{lead}:</b> closing now gives {amountOf(close, close === best)}, keeping gives {amountOf(keep, keep === best)}, the wing gives {amountOf(wing, wing === best)}.
                          {x.kind === 'target' && <> This is the price that gets back {targetLabel}.</>}
                          {x.kind === 'deep' && keep > wing + 0.005 && <> Keeping beats the wing by {usd(keep - wing)}.</>}
                        </p>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-400" data-testid="salvage-bottom-line">
                    {req && 'price' in req && p.stockPrice
                      ? <>To get back {targetLabel}, {p.symbol} would have to finish at or {right === 'P' ? 'below' : 'above'} <b>{usd(req.price)}</b> by {p.expDate}, about {Math.round(Math.abs(p.stockPrice - req.price) / p.stockPrice * 100)}% {right === 'P' ? 'below' : 'above'} today&apos;s {usd(p.stockPrice)}.</>
                      : req && 'already' in req ? <>The cash from this wing already covers {targetLabel}.</>
                      : <>With the {sel.strike} wing, {p.symbol} cannot get back {targetLabel} by expiry.</>}
                    {' '}Nobody knows where {p.symbol} ends. These are examples, not predictions; &quot;most&quot; marks the highest dollars at that price.
                  </p>
                </>)}
                <details className="text-xs text-slate-400">
                  <summary className="min-h-9 cursor-pointer py-2 text-slate-300">Change target ({objective === 'amount' ? usd(vm.target, 0) : objective === 'debit' ? `original debit ${vm.long ? usd(vm.long.entryDebit, 0) : ''}` : 'most dollars'})</summary>
                  <div className="flex flex-wrap items-end gap-2">
                    <button type="button" className={pill(objective === 'most')} aria-pressed={objective === 'most'} onClick={() => setObjective('most')}>Most dollars</button>
                    <button type="button" className={pill(objective === 'amount')} aria-pressed={objective === 'amount'} onClick={() => setObjective('amount')}>A dollar amount</button>
                    <button type="button" className={pill(objective === 'debit')} aria-pressed={objective === 'debit'} onClick={() => setObjective('debit')}>Original debit {vm.long ? usd(vm.long.entryDebit, 0) : ''}</button>
                    {objective === 'amount' && (
                      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Dollar amount from today
                        <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} className="mt-1 block min-h-11 w-36 rounded-lg border border-slate-600 bg-slate-950 px-3 text-sm font-normal normal-case tracking-normal text-white" />
                      </label>
                    )}
                  </div>
                  <p className="mt-1">Original debit is a sunk-cost check only. It does not change what each choice is worth from here.</p>
                </details>
                {sel && vm.scenarios.length > 0 && (
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
                )}
              </div>
            </div>

            <section className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-2" aria-label="Order">
              <p className="max-w-xl text-xs text-slate-400">Proposal only. You review the order, run a broker dry run, and press Submit yourself. Salvage never places, changes or cancels an order on its own.</p>
              <div className="flex flex-col items-end gap-1">
                <button type="button" onClick={onReview} disabled={!onReview || !!reviewBlockedReason || !sel} data-testid="salvage-review-open" className="min-h-11 rounded-lg bg-emerald-500 px-4 text-sm font-bold text-emerald-950 focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-40">{sel ? `Review order: sell ${wingQuantity} ${p.symbol} ${sel.strike} ${word}` : 'Review order'}</button>
                {(reviewBlockedReason || !onReview) && <p className="text-xs text-amber-300" data-testid="salvage-review-blocked">{reviewBlockedReason ?? 'Order review is not available here.'}</p>}
              </div>
            </section>
          </div>
        </details>
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
  const rankBy: RankBy = 'nearest'; // nearest strike first; the wing list has no ranking buttons (Ian, Paul, Diane 2026-10-16)
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
      <div className="mx-auto max-w-7xl rounded-2xl border border-slate-700 bg-slate-950 p-4">
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
          amountText={amountText} setAmountText={setAmountText}
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
