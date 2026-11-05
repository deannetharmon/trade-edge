// features/screener/components/AssignmentCashPanel.tsx

// ASSIGN-CASH-0001: the trade-ticket panel showing total potential assignment obligation against usable cash, before the
// trader opens or adjusts a position. Loads cash-balance, open positions and working orders once when the ticket opens
// (a Refresh link reloads them); quantity and strike changes recompute locally from that snapshot. The submit-time
// re-check in the order flow always re-fetches, so what this panel shows is never what the order is allowed on.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  evaluateAssignmentCash, type AssignmentCashResult, type ProposedOrder,
} from '@/lib/scans/assignmentCash';
import { loadAssignmentCashSnapshot, type AssignmentCashSnapshot } from '@/lib/scans/assignmentCashLoader';
import {
  loadAssignmentCashSettings, saveAssignmentCashSettings, type AssignmentCashSettings,
} from '@/lib/scans/assignmentCashSettings';

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (u: number) => `${(u * 100).toFixed(1)}%`;

export interface AssignmentCashPanelProps {
  proposed: ProposedOrder;
  labelClass: string;
  valueClass: string;
  disabled?: boolean;
  acknowledged: boolean;
  onAcknowledgedChange: (v: boolean) => void;
  borrowingConfirmed: boolean;
  onBorrowingConfirmedChange: (v: boolean) => void;
  /** Reports the current evaluation and settings so the order flow can gate the Place button. */
  onEvaluation: (result: AssignmentCashResult, settings: AssignmentCashSettings) => void;
}

export default function AssignmentCashPanel(props: AssignmentCashPanelProps) {
  const { proposed, labelClass, valueClass, disabled, acknowledged, onAcknowledgedChange, borrowingConfirmed, onBorrowingConfirmedChange, onEvaluation } = props;
  const [snapshot, setSnapshot] = useState<AssignmentCashSnapshot | undefined>(undefined);
  const [settings, setSettings] = useState<AssignmentCashSettings>(() => loadAssignmentCashSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [marginRiskUnderstood, setMarginRiskUnderstood] = useState(false);

  const refresh = useCallback(async () => {
    setSnapshot(undefined);
    setSnapshot(await loadAssignmentCashSnapshot());
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const result = useMemo(() => evaluateAssignmentCash({
    cashBalance: snapshot?.cashBalance ?? null,
    reserve: settings.reserve,
    positions: snapshot?.positions ?? null,
    pendingOrders: snapshot?.pendingOrders ?? null,
    proposed,
    marginBackedEnabled: settings.marginBackedEnabled,
  }), [snapshot, settings, proposed]);

  useEffect(() => { onEvaluation(result, settings); }, [result, settings, onEvaluation]);

  // A confirmation belongs to the numbers it was given on; clear it when the numbers move to a state that no longer needs it.
  useEffect(() => { if (result.submit !== 'needs_acknowledgment' && acknowledged) onAcknowledgedChange(false); }, [result.submit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (result.submit !== 'needs_borrowing_confirmation' && borrowingConfirmed) onBorrowingConfirmedChange(false); }, [result.submit]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: AssignmentCashSettings) => { setSettings(next); saveAssignmentCashSettings(next); };

  const loading = snapshot === undefined;
  const barColor = result.tier === 'blocked' || result.tier === 'acknowledge' ? 'bg-red-500' : result.tier === 'warn' ? 'bg-amber-400' : 'bg-emerald-500';
  const barWidth = result.utilization == null ? (result.tier === 'blocked' ? 100 : 0) : Math.min(100, result.utilization * 100);
  const shortfall = result.surplusShortfall != null && result.surplusShortfall < 0;

  return (
    <div className="space-y-1" data-testid="assignment-cash-panel">
      <div className="flex justify-between text-xs">
        <span className={labelClass}>Assignment cash after this trade</span>
        <span className={valueClass} data-testid="assignment-cash-after">{loading ? 'Loading…' : result.assignmentCashAfter == null ? 'Unavailable' : money(result.assignmentCashAfter)}</span>
      </div>
      <div className="flex justify-between text-xs">
        <span className={labelClass}>Usable cash after reserve</span>
        <span className={valueClass} data-testid="assignment-usable-cash">{loading ? 'Loading…' : result.usableCash == null ? 'Unavailable' : money(result.usableCash)}</span>
      </div>
      <div className="flex justify-between text-xs">
        <span className={labelClass}>Funding surplus/shortfall</span>
        <span className={shortfall ? 'text-red-400 font-semibold' : 'text-emerald-400'} data-testid="assignment-surplus">
          {loading ? 'Loading…' : result.surplusShortfall == null ? 'Unavailable' : `${shortfall ? 'Shortfall ' : 'Surplus '}${money(Math.abs(result.surplusShortfall))}`}
        </span>
      </div>

      {!loading && result.utilization != null && (
        <div className="pt-1" data-testid="assignment-utilization">
          <div className="h-1.5 w-full rounded bg-slate-700 overflow-hidden"><div className={`h-full ${barColor}`} style={{ width: `${barWidth}%` }} /></div>
          <div className={`text-[10px] mt-0.5 ${labelClass}`}>{pct(result.utilization)} of usable cash committed to potential assignment</div>
        </div>
      )}

      {!loading && result.submit === 'cannot_verify' && (
        <p className="text-[10px] text-slate-300 pt-1" data-testid="assignment-cannot-verify">
          Cannot verify funding. {result.reasons.join('; ')}.{' '}
          <button type="button" className="underline" onClick={() => void refresh()} disabled={disabled}>Refresh</button>
        </p>
      )}

      {!loading && result.tier === 'warn' && (
        <p className="text-[10px] text-amber-300 pt-1" data-testid="assignment-warning">
          A large share of your usable cash is committed to potential assignment.
        </p>
      )}

      {!loading && result.submit === 'needs_acknowledgment' && (
        <label className="flex items-start gap-2 text-[10px] text-amber-300 pt-1" data-testid="assignment-acknowledge">
          <input type="checkbox" className="mt-0.5" checked={acknowledged} disabled={disabled} onChange={e => onAcknowledgedChange(e.target.checked)} />
          <span>A large share of your usable cash is committed to potential assignment. If these puts are assigned, you would have {money(Math.max(0, result.surplusShortfall ?? 0))} left. I understand and want to place this order.</span>
        </label>
      )}

      {!loading && result.submit === 'blocked' && (
        <p className="text-[10px] text-red-400 pt-1" data-testid="assignment-blocked">
          Blocked: if every short put were assigned you would be short {money(result.borrowedAmount)}. Reduce the quantity or free up cash. Margin-backed assignment is off (see settings below).
        </p>
      )}

      {!loading && result.submit === 'needs_borrowing_confirmation' && (
        <label className="flex items-start gap-2 text-[10px] text-red-400 pt-1" data-testid="assignment-borrowing">
          <input type="checkbox" className="mt-0.5" checked={borrowingConfirmed} disabled={disabled} onChange={e => onBorrowingConfirmedChange(e.target.checked)} />
          <span>This order commits more than your usable cash. If every short put were assigned, about {money(result.borrowedAmount)} would be funded with borrowed money. I confirm the borrowing risk for this order.</span>
        </label>
      )}

      <div className="pt-1 text-[10px]">
        <button type="button" className={`underline ${labelClass}`} onClick={() => setShowSettings(s => !s)} data-testid="assignment-settings-toggle">
          {showSettings ? 'Hide cash check settings' : 'Cash check settings'}
        </button>
        {!loading && <button type="button" className={`underline ml-3 ${labelClass}`} onClick={() => void refresh()} disabled={disabled}>Refresh</button>}
      </div>

      {showSettings && (
        <div className="rounded border border-slate-700 p-2 space-y-2 text-[10px]" data-testid="assignment-settings">
          <div className="flex items-center justify-between gap-2">
            <span className={labelClass}>Cash reserve</span>
            <span className="flex items-center gap-1">
              <input
                type="number" min={0} max={settings.reserve.kind === 'percent' ? 100 : undefined} step="any"
                className="w-20 bg-transparent border border-slate-700 rounded px-1 py-0.5 text-right"
                value={settings.reserve.value}
                onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) update({ ...settings, reserve: { ...settings.reserve, value: v } }); }}
              />
              <select
                className="bg-transparent border border-slate-700 rounded px-1 py-0.5"
                value={settings.reserve.kind}
                onChange={e => update({ ...settings, reserve: e.target.value === 'fixed' ? { kind: 'fixed', value: 0 } : { kind: 'percent', value: 5 } })}
              >
                <option value="percent">% of cash</option>
                <option value="fixed">$ fixed</option>
              </select>
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className={labelClass}>Margin-backed assignment</span>
              <span className={settings.marginBackedEnabled ? 'text-red-400 font-semibold' : valueClass}>{settings.marginBackedEnabled ? 'ON' : 'OFF'}</span>
            </div>
            {settings.marginBackedEnabled ? (
              <button type="button" className="underline text-slate-300" onClick={() => { setMarginRiskUnderstood(false); update({ ...settings, marginBackedEnabled: false }); }}>Turn off</button>
            ) : (
              <>
                <label className="flex items-start gap-2 text-amber-300">
                  <input type="checkbox" className="mt-0.5" checked={marginRiskUnderstood} onChange={e => setMarginRiskUnderstood(e.target.checked)} />
                  <span>I understand that with this on, assignment may be funded with borrowed money, which can lose more than the cash in my account. Orders above my usable cash will still need a confirmation each time.</span>
                </label>
                <button type="button" disabled={!marginRiskUnderstood} className="underline text-slate-300 disabled:opacity-40" onClick={() => update({ ...settings, marginBackedEnabled: true })}>Turn on</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
