// components/paper-trading/PaperMarkForm.tsx
//
// PT-0001 section 12: explicit, manual mark refresh. No automatic browser-
// owned quote wiring exists in Phase 1 (see docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md
// "Known limitations") -- the user enters the current bid/ask themselves,
// exactly like the entry/close tickets, and this never fabricates a P/L
// figure when quotes are withheld.

'use client';

import { useMemo, useState } from 'react';
import { computeMarketableFill, oldestQuoteAgeSeconds, isStale, STALE_QUOTE_THRESHOLD_SECONDS } from '@/lib/paper-trading/pricing';
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

export default function PaperMarkForm({ position, onMarked, onCancel }: { position: PaperTradingPosition; onMarked: () => void; onCancel: () => void }) {
  const [legQuotes, setLegQuotes] = useState<Record<string, { bid: string; ask: string }>>({});
  const [quoteObservedAt, setQuoteObservedAt] = useState(nowLocalDateTime());
  const [staleConfirmed, setStaleConfirmed] = useState(false);
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
    if (!quoteSnapshot) return null;
    const allPriced = position.legs.every((leg) => {
      const q = legQuotes[leg.legId];
      return q?.bid && q?.ask;
    });
    if (!allPriced) return null;
    try {
      const fill = computeMarketableFill(position.legs, quoteSnapshot, 'close', position.quantity, position.contractMultiplier);
      return { markValue: fill.netValue, unrealizedPnl: position.entryCredit - fill.netValue };
    } catch {
      return null;
    }
  }, [position, quoteSnapshot, legQuotes]);

  async function handleMark() {
    setErrorMsg(null);
    if (stale && !staleConfirmed) {
      setErrorMsg('This quote appears stale. Please confirm before proceeding.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/paper-trading/positions/${position.positionId}/mark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteSnapshot, staleConfirmed, manualOverride: null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorMsg(body?.error ?? 'Failed to refresh mark.');
        return;
      }
      onMarked();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-950/10 p-3">
      <p className="text-xs font-semibold text-cyan-200">Refresh Mark (enter current bid/ask)</p>
      <div className="mt-2 space-y-2">
        {position.legs.map((leg) => {
          const q = legQuotes[leg.legId] ?? { bid: '', ask: '' };
          return (
            <div key={leg.legId} className="grid grid-cols-3 items-end gap-2">
              <span className="text-[10px] text-slate-400">
                {leg.optionType.toUpperCase()} {leg.strike}
              </span>
              <input
                type="number"
                placeholder="Bid"
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                value={q.bid}
                onChange={(e) => setLegQuotes((prev) => ({ ...prev, [leg.legId]: { ...q, bid: e.target.value } }))}
              />
              <input
                type="number"
                placeholder="Ask"
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                value={q.ask}
                onChange={(e) => setLegQuotes((prev) => ({ ...prev, [leg.legId]: { ...q, ask: e.target.value } }))}
              />
            </div>
          );
        })}
      </div>

      {stale && (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-950/30 p-2 text-[11px] text-amber-100">
          <p>Stale quote (threshold {Math.round(STALE_QUOTE_THRESHOLD_SECONDS / 60)}m).</p>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={staleConfirmed} onChange={(e) => setStaleConfirmed(e.target.checked)} />
            Confirm use of stale quote.
          </label>
        </div>
      )}

      {preview && (
        <p className="mt-2 text-[11px] text-slate-300">
          New unrealized P/L: <span className={preview.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>${preview.unrealizedPnl.toFixed(2)}</span>
        </p>
      )}
      {errorMsg && <p className="mt-2 text-[11px] text-rose-300">{errorMsg}</p>}

      <div className="mt-2 flex gap-2">
        <button
          onClick={handleMark}
          disabled={submitting}
          className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          {submitting ? 'Refreshing…' : 'Update Mark'}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
          Cancel
        </button>
      </div>
    </div>
  );
}
