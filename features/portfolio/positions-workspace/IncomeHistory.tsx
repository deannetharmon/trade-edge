// features/portfolio/positions-workspace/IncomeHistory.tsx
//
// LEAPS-CYCLES-0001 -- "Income history" for a held LEAPS: the short calls sold on this stock since the LEAPS was opened, how each ended, and
// the income they produced (net of fees), from the Trade Log's reconstruction of your broker transactions. Loaded only when you ask for it.
// Every number comes from lib/leaps-position-intelligence/cycleHistory.ts; nothing here is estimated.

import { useState } from 'react';
import { CalloutList, TileGrid } from '@/components/dashboard/DashboardParts';
import { money, type DashboardCallout, type DashboardTile } from '@/lib/leaps-analysis/dashboard';
import { buildCycleHistory, type CycleHistory, type CycleResult } from '@/lib/leaps-position-intelligence/cycleHistory';
import { signedMoney } from '@/lib/leaps-position-intelligence/incomeCard';
import { loadClosedTrades } from './cycleTradesLoader';

type Status = 'idle' | 'loading' | 'ready' | 'other-account' | 'error';

const RESULT_LABEL: Record<CycleResult, string> = { expired: 'Expired', assigned: 'Assigned', closed: 'Closed', rolled: 'Rolled', partial: 'Partly closed' };

export function IncomeHistory({ accountNumber, underlying, longEntryDate, extrinsicLostDollars, th }: {
  accountNumber: string;
  underlying: string;
  longEntryDate: string | null;
  /** Extrinsic value the LEAPS has lost since it was opened, in dollars (null when there is no at-open record to compute it from). */
  extrinsicLostDollars: number | null;
  th: { text: string; textMuted: string; textFaint?: string };
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [history, setHistory] = useState<CycleHistory | null>(null);

  const load = async () => {
    if (status === 'loading') return;
    setStatus('loading');
    try {
      const loaded = await loadClosedTrades();
      if (loaded.accountNumber && loaded.accountNumber !== accountNumber) { setStatus('other-account'); return; }
      setHistory(buildCycleHistory({ trades: loaded.trades, unmatchedClosures: loaded.unmatchedClosures, underlying, longEntryDate, windowFrom: loaded.windowFrom }));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  };

  const tiles: DashboardTile[] = history ? [
    { id: 'cycles', label: 'Short calls', value: String(history.totals.count), tone: 'neutral', parts: [{ text: `${history.totals.wins} profitable`, tone: 'neutral' }] },
    { id: 'income', label: 'Income to date', value: signedMoney(history.totals.pnl), tone: history.totals.pnl >= 0 ? 'good' : 'watch', parts: [{ text: `${money(history.totals.credit)} collected · net of fees`, tone: 'neutral' }] },
    { id: 'hold', label: 'Avg days held', value: history.totals.count > 0 ? String(history.totals.avgHoldDays) : '—', tone: 'neutral', parts: [] },
  ] : [];

  const callouts: DashboardCallout[] = [];
  if (history && history.rows.length > 0) {
    if (extrinsicLostDollars != null) {
      const diff = history.totals.pnl - extrinsicLostDollars;
      callouts.push(diff >= 0
        ? { id: 'vs-extrinsic', tone: 'good', text: `Income so far ${money(history.totals.pnl)} covers the LEAPS's ${money(Math.round(extrinsicLostDollars * 100) / 100)} extrinsic loss, ${money(Math.round(diff * 100) / 100)} ahead.` }
        : { id: 'vs-extrinsic', tone: 'watch', text: `Income so far ${money(history.totals.pnl)} is ${money(Math.round(-diff * 100) / 100)} short of the LEAPS's ${money(Math.round(extrinsicLostDollars * 100) / 100)} extrinsic loss.` });
    } else {
      callouts.push({ id: 'vs-extrinsic', tone: 'neutral', text: 'Extrinsic lost needs a record from when the LEAPS was opened, so income is not compared to it yet.' });
    }
  }
  if (history && !history.coversFullHistory && history.reason === 'ok') {
    callouts.push({ id: 'window', tone: 'watch', text: `The Trade Log looks back to ${history.windowFrom}; short calls sold before that are not shown.` });
  }
  if (history && history.unmatchedCount > 0) {
    callouts.push({ id: 'unmatched', tone: 'watch', text: `${history.unmatchedCount} closing${history.unmatchedCount === 1 ? '' : 's'} on this stock could not be matched to ${history.unmatchedCount === 1 ? 'its' : 'their'} opening (opened before the window), so income may be understated.` });
  }

  return (
    <div data-testid="income-history" className="mt-1">
      {status === 'idle' && (
        <button type="button" onClick={() => void load()} className="min-h-8 rounded border border-white/15 px-3 text-[10px] text-neutral-300 focus:ring-2 focus:ring-teal-400">Show income history</button>
      )}
      {status === 'loading' && <p className="text-[10px] text-neutral-400">Loading your short-call history from the Trade Log…</p>}
      {status === 'error' && (
        <p className="text-[10px] text-amber-300">Could not load the Trade Log. <button type="button" onClick={() => void load()} className="ml-1 underline focus:ring-2 focus:ring-teal-400">Try again</button></p>
      )}
      {status === 'other-account' && <p className="text-[10px] text-amber-300">The Trade Log covers your active account only, and this LEAPS is in a different account.</p>}
      {status === 'ready' && history && (
        <div className="space-y-2">
          <p className="text-[9px] uppercase tracking-wider text-neutral-400">Income history · short calls on {underlying} since you opened this LEAPS</p>
          {history.reason === 'no-entry-date' && <p className="text-[10px] text-amber-300">The broker did not give an open date for this LEAPS, so its short calls cannot be matched.</p>}
          {history.reason === 'ok' && history.rows.length === 0 && <p className="text-[10px] text-neutral-400">No short calls have been sold on {underlying} since you opened this LEAPS.</p>}
          {history.rows.length > 0 && <TileGrid tiles={tiles} th={th} columnsClass="grid-cols-3" />}
          <CalloutList callouts={callouts} th={th} />
          {history.rows.length > 0 && (
            <ul className="space-y-1 text-[10px]">
              {history.rows.map(row => (
                <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded border border-white/10 px-2 py-1">
                  <span className={th.text}>{row.openDate} → {row.closeDate}</span>
                  <span className="text-neutral-400">{row.contracts}× {row.strike} exp {row.expiry}</span>
                  <span className="text-neutral-400">credit {money(row.credit)}</span>
                  <span className={row.pnl >= 0 ? 'text-emerald-400' : 'text-amber-300'}>{signedMoney(row.pnl)}</span>
                  <span className="text-neutral-400">{RESULT_LABEL[row.result]}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[9px] text-neutral-500">Includes any covered calls sold on shares of the same stock. Fees are included; a roll shows as its closed call and its new call.</p>
        </div>
      )}
    </div>
  );
}
