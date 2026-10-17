'use client';
// features/portfolio/positions-workspace/salvage/SalvageReview.tsx
//
// SALVAGE-0001 slice D -- order review, per the mock approved 2026-10-16.
// Flow: review -> broker dry run -> Submit (enabled only after a clean dry run).
// At Submit the position and quotes are re-read; anything that moved blocks the
// order. Nothing here is automatic: the trader presses every button.

import { useMemo, useState } from 'react';
import type { Position } from '@/lib/portfolio-data/types';
import type { TickTable } from '@/lib/portfolio/tickSize';
import type { WingRow } from '@/lib/salvage/salvageCandidates';
import type { EligibleSalvage } from '@/lib/salvage/salvageEligibility';
import type { SalvageDryRunResult } from '@/lib/salvage/salvageDryRun';
import { buildSalvageOrder, submitSalvageOrderIfSafe, type SalvageReviewed } from '@/lib/salvage/salvageOrder';
import type { SalvageDeps } from './SalvageDeps';

const usd = (n: number, digits = 2) =>
  (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

type Phase = 'review' | 'dry-running' | 'dry-ok' | 'dry-bad' | 'submitting' | 'done' | 'blocked';

export interface ReloadedWing { row: WingRow | null; tickTable: TickTable | null }

export function SalvageReview({
  position, eligible, row, wingQuantity, tickTable, objectiveLine, earnings, deps, reload, onBack, onClose,
}: {
  position: Position;
  eligible: EligibleSalvage;
  row: WingRow;
  wingQuantity: number;
  tickTable: TickTable | null;
  /** e.g. "Original debit $2,574: can meet only if MRNA finishes at or below $114.74." */
  objectiveLine: string;
  earnings: { before: boolean; date: string | null; daysAway: number | null };
  deps: SalvageDeps;
  /** Re-reads the chain and returns the same strike's fresh row. */
  reload: () => Promise<ReloadedWing>;
  onBack: () => void;
  onClose: () => void;
}) {
  const right = eligible.right;
  const word = right === 'P' ? 'put' : 'call';
  const built = useMemo(
    () => buildSalvageOrder({ occSymbol: row.occSymbol, quantity: wingQuantity, bid: row.bid, tickTable }),
    [row.occSymbol, row.bid, wingQuantity, tickTable],
  );
  const reviewed: SalvageReviewed | null = built.ok && row.occSymbol ? {
    accountNumber: position.accountNumber, right, strike: eligible.strike, expDate: eligible.expDate, quantity: eligible.quantity,
    wingStrike: row.strike, wingOcc: row.occSymbol, wingQuantity, pricePerShare: built.pricePerShare,
  } : null;

  const [phase, setPhase] = useState<Phase>('review');
  const [dry, setDry] = useState<SalvageDryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState('');
  // The price the dry run was run for; submit is only offered for that exact price.
  const [dryPrice, setDryPrice] = useState<number | null>(null);

  if (!built.ok || !reviewed) {
    return <div role="alert" className="rounded-xl border border-red-800 bg-red-950/50 p-4 text-sm text-red-200">This order cannot be built: {built.ok ? 'the option symbol is missing.' : built.reason}<div className="mt-3"><button type="button" onClick={onBack} className="min-h-11 rounded-lg border border-slate-600 bg-slate-900 px-4 text-sm text-slate-100">Back</button></div></div>;
  }
  const price = built.pricePerShare;
  const credit = price * 100 * wingQuantity;
  const fees = dry?.fees ?? (1.14 * wingQuantity);
  const width = Math.abs(eligible.strike - row.strike) * 100 * wingQuantity;
  const busy = phase === 'dry-running' || phase === 'submitting';
  const canSubmit = phase === 'dry-ok' && dry?.valid === true && dryPrice === price;

  async function runDry() {
    setPhase('dry-running'); setError(null);
    try {
      const result = await deps.dryRun(built.ok ? built.order : (null as never), reviewed!.accountNumber);
      setDry(result); setDryPrice(price);
      setPhase(result.valid ? 'dry-ok' : 'dry-bad');
    } catch (e: any) {
      setDry(null); setError(e?.message ?? 'The dry run failed.'); setPhase('dry-bad');
    }
  }

  async function submit() {
    setPhase('submitting'); setError(null);
    try {
      const [fresh, wing] = await Promise.all([deps.fetchFreshPosition(position.key), reload()]);
      const outcome = await submitSalvageOrderIfSafe(
        { reviewed: reviewed!, freshPosition: fresh, freshRow: wing.row, tickTable: wing.tickTable },
        (order, acct) => deps.submit(order, acct),
      );
      if (!outcome.submitted) {
        setError(outcome.reason);
        setDry(null); setDryPrice(null);
        setPhase('blocked');
        return;
      }
      setOrderId(outcome.result.orderId);
      setPhase('done');
    } catch (e: any) {
      setError(e?.message ?? 'The order could not be placed.');
      setPhase('blocked');
    }
  }

  return (
    <div className="space-y-4 text-slate-200" data-testid="salvage-review">
      <header className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Review order · nothing is placed until you submit</p>
        <h2 className="text-xl font-semibold text-white">Sell to open {wingQuantity} {position.symbol} {eligible.expDate} {row.strike} {word}</h2>
        <p className="text-sm text-slate-400">Keeps your long {eligible.strike} {word}. Together they form a {right === 'P' ? 'bear put' : 'bull call'} spread.</p>
      </header>

      <dl className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-slate-400">Limit price (the bid), Day order</dt><dd className="font-semibold" data-testid="review-price">{usd(price)} credit</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-400">Credit before fees</dt><dd className="font-semibold">{usd(credit)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-400">Fees ({dry?.fees != null ? 'broker estimate' : 'our estimate'})</dt><dd className="font-semibold">{usd(fees)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-400">Net cash today</dt><dd className="font-semibold text-emerald-300" data-testid="review-net">{usd(credit - fees)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-400">The spread pays at most at expiry</dt><dd className="font-semibold">{usd(width, 0)} (width × 100)</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-400">Pays anything only if {position.symbol} is {right === 'P' ? 'below' : 'above'}</dt><dd className="font-semibold">{usd(eligible.strike, 0)}</dd></div>
        {dry?.buyingPowerChange != null && <div className="flex justify-between gap-4"><dt className="text-slate-400">Buying power (broker dry run)</dt><dd className="font-semibold" data-testid="review-bp">{dry.buyingPowerChange <= 0 ? `frees ${usd(Math.abs(dry.buyingPowerChange))}` : `uses ${usd(dry.buyingPowerChange)}`}</dd></div>}
      </dl>

      <section className="space-y-1 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="font-semibold text-white">Your objective</p>
        <p className="text-slate-300">{objectiveLine}</p>
        <p className="text-xs text-slate-400">This adjustment does not recover the loss by itself. It trades the long {word}&apos;s payoff beyond {usd(row.strike, 0)} for {usd(credit - fees)} now.</p>
      </section>

      {earnings.before && (
        <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">
          <b>Earnings {earnings.date}, before expiry.</b> Event volatility impact is not available.
        </div>
      )}
      {row.warnings.includes('WIDE_MARKET') && <div role="alert" className="rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">The market on this {word} is wide. The order is a limit at the bid and may not fill.</div>}

      {phase === 'dry-ok' && dry && (
        <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-3 text-sm text-emerald-200" data-testid="review-dry-ok">
          Dry run passed. The broker accepts this order.{dry.warnings.length > 0 && <> Broker notes: {dry.warnings.join(' · ')}</>}
        </div>
      )}
      {(phase === 'dry-bad' || phase === 'blocked') && (
        <div role="alert" className="rounded-lg border border-red-800 bg-red-950/50 p-3 text-sm text-red-200" data-testid="review-error">
          {phase === 'blocked' ? 'Order not sent. ' : 'Dry run failed. '}
          {error ?? dry?.errors.join(' · ') ?? 'The broker rejected the order.'}
        </div>
      )}
      {phase === 'done' && (
        <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-3 text-sm text-emerald-200" data-testid="review-done">
          Order submitted to the broker (order {orderId}). Check Orders for the fill.
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-end gap-2">
        {phase !== 'done' && <button type="button" onClick={onBack} disabled={busy} className="min-h-11 rounded-lg border border-slate-600 bg-slate-900 px-4 text-sm disabled:opacity-50">Back</button>}
        {phase !== 'done' && <button type="button" onClick={() => void runDry()} disabled={busy} data-testid="review-dry-run" className="min-h-11 rounded-lg border border-slate-600 bg-slate-900 px-4 text-sm disabled:opacity-50">{phase === 'dry-running' ? 'Running…' : 'Run dry run'}</button>}
        {phase !== 'done' && <button type="button" onClick={() => void submit()} disabled={!canSubmit || busy} data-testid="review-submit" title={canSubmit ? undefined : 'Run the dry run first'} className="min-h-11 rounded-lg bg-emerald-500 px-4 text-sm font-bold text-emerald-950 disabled:cursor-not-allowed disabled:opacity-40">{phase === 'submitting' ? 'Submitting…' : 'Submit order'}</button>}
        {phase === 'done' && <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-600 bg-slate-900 px-4 text-sm">Close</button>}
      </footer>
    </div>
  );
}
