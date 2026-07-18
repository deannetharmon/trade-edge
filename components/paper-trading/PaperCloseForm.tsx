// components/paper-trading/PaperCloseForm.tsx
//
// PT-0001 section 11.2: full-position close only. Shows current mid,
// marketable close, proposed simulated fill, estimated realized P/L,
// pricing source, and a stale-quote / manual-override path identical in
// spirit to the entry ticket. Client component -- pure lib/paper-trading
// modules only (no service.ts/index.ts import), same reasoning as the
// ticket form.

'use client';

import { useMemo, useState } from 'react';
import { computeMarketableFill, oldestQuoteAgeSeconds, isStale, STALE_QUOTE_THRESHOLD_SECONDS, resolveClosingAction } from '@/lib/paper-trading/pricing';
import type { PaperTradingPosition } from '@/lib/paper-trading/types';

// See PaperTicketForm.tsx's formatLocalDateTime() doc comment: datetime-local
// values are local wall-clock time and must be formatted from local getters,
// not toISOString() (UTC), or the represented moment silently shifts by the
// local UTC offset outside of UTC.
function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowLocalDateTime(): string {
  return formatLocalDateTime(new Date());
}

export default function PaperCloseForm({ position, onClosed, onCancel }: { position: PaperTradingPosition; onClosed: () => void; onCancel: () => void }) {
  const [legQuotes, setLegQuotes] = useState<Record<string, { bid: string; ask: string }>>({});
  const [quoteObservedAt, setQuoteObservedAt] = useState(nowLocalDateTime());
  const [staleConfirmed, setStaleConfirmed] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [manualPrice, setManualPrice] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [idempotencyKey] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `key_${Date.now()}`));
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const quoteTimestampIso = useMemo(() => {
    const d = new Date(quoteObservedAt);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }, [quoteObservedAt]);

  const quoteSnapshot = useMemo(() => {
    if (!quoteTimestampIso) return null;
    return {
      source: 'manual' as const,
      legs: position.legs.map((leg) => {
        const q = legQuotes[leg.legId] ?? { bid: '', ask: '' };
        return {
          legId: leg.legId,
          bid: q.bid === '' ? null : Number(q.bid),
          ask: q.ask === '' ? null : Number(q.ask),
          mid: q.bid !== '' && q.ask !== '' ? (Number(q.bid) + Number(q.ask)) / 2 : null,
          quoteTimestamp: quoteTimestampIso,
        };
      }),
    };
  }, [position.legs, legQuotes, quoteTimestampIso]);

  const ageSeconds = quoteSnapshot ? oldestQuoteAgeSeconds(quoteSnapshot, new Date()) : null;
  const stale = isStale(ageSeconds);

  const preview = useMemo(() => {
    if (manualOverride || !quoteSnapshot) return null;
    const allPriced = position.legs.every((leg) => {
      const q = legQuotes[leg.legId];
      return q?.bid && q?.ask;
    });
    if (!allPriced) return null;
    try {
      const fill = computeMarketableFill(position.legs, quoteSnapshot, 'close', position.quantity, position.contractMultiplier);
      return { closingDebit: fill.netValue, mid: fill.midNetValue, realizedPnl: position.entryCredit - fill.netValue };
    } catch {
      return null;
    }
  }, [position, quoteSnapshot, legQuotes, manualOverride]);

  async function handleClose() {
    setErrorMsg(null);
    if (manualOverride && (!manualPrice || !manualReason)) {
      setErrorMsg('Manual Paper Fill requires a price and a reason.');
      return;
    }
    if (stale && !manualOverride && !staleConfirmed) {
      setErrorMsg('This quote appears stale. Please confirm before proceeding.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/paper-trading/positions/${position.positionId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          quoteSnapshot,
          staleConfirmed,
          manualOverride: manualOverride
            ? { manualPrice: Number(manualPrice), reason: manualReason, confirmedAt: new Date().toISOString(), confirmedByUser: 'dean' }
            : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorMsg(body?.error ?? 'Failed to close position.');
        return;
      }
      onClosed();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-950/10 p-3">
      <p className="text-xs font-semibold text-rose-200">Close Paper Position (full close only)</p>
      <div className="mt-2 space-y-2">
        {position.legs.map((leg) => {
          const closeAction = resolveClosingAction(leg.openAction);
          const q = legQuotes[leg.legId] ?? { bid: '', ask: '' };
          return (
            <div key={leg.legId} className="grid grid-cols-3 items-end gap-2">
              <span className="text-[10px] text-slate-400">
                {leg.optionType.toUpperCase()} {leg.strike} ({closeAction})
              </span>
              <label className="text-[10px] text-slate-500">
                Bid
                <input
                  type="number"
                  className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                  value={q.bid}
                  onChange={(e) => setLegQuotes((prev) => ({ ...prev, [leg.legId]: { ...q, bid: e.target.value } }))}
                />
              </label>
              <label className="text-[10px] text-slate-500">
                Ask
                <input
                  type="number"
                  className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                  value={q.ask}
                  onChange={(e) => setLegQuotes((prev) => ({ ...prev, [leg.legId]: { ...q, ask: e.target.value } }))}
                />
              </label>
            </div>
          );
        })}
      </div>

      <label className="mt-2 block text-[10px] text-slate-500">
        Quote observed at
        <input
          type="datetime-local"
          className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
          value={quoteObservedAt}
          onChange={(e) => setQuoteObservedAt(e.target.value)}
        />
      </label>

      {stale && !manualOverride && (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-950/30 p-2 text-[11px] text-amber-100">
          <p>
            Stale quote ({ageSeconds != null ? Math.round(ageSeconds / 60) : '?'}m old, threshold {Math.round(STALE_QUOTE_THRESHOLD_SECONDS / 60)}m).
          </p>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={staleConfirmed} onChange={(e) => setStaleConfirmed(e.target.checked)} />
            Confirm use of stale quote.
          </label>
        </div>
      )}

      <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-300">
        <input type="checkbox" checked={manualOverride} onChange={(e) => setManualOverride(e.target.checked)} />
        Manual Paper Fill override
      </label>
      {manualOverride && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            type="number"
            placeholder="Manual close price"
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            value={manualPrice}
            onChange={(e) => setManualPrice(e.target.value)}
          />
          <input
            placeholder="Reason"
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
            value={manualReason}
            onChange={(e) => setManualReason(e.target.value)}
          />
        </div>
      )}

      {preview && (
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
          <div>
            <p className="text-slate-500">Mid Close</p>
            <p className="text-white">{preview.mid != null ? `$${preview.mid.toFixed(2)}` : '—'}</p>
          </div>
          <div>
            <p className="text-slate-500">Simulated Fill</p>
            <p className="text-white">${preview.closingDebit.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-slate-500">Est. Realized P/L</p>
            <p className={preview.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>${preview.realizedPnl.toFixed(2)}</p>
          </div>
        </div>
      )}

      {errorMsg && <p className="mt-2 rounded border border-rose-500/40 bg-rose-950/30 p-2 text-[11px] text-rose-200">{errorMsg}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={handleClose}
          disabled={submitting}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
        >
          {submitting ? 'Closing…' : 'Close Paper Position'}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
          Cancel
        </button>
      </div>
    </div>
  );
}
