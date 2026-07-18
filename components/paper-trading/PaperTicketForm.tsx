// components/paper-trading/PaperTicketForm.tsx
//
// PT-0001 section 11.1: manual paper ticket for the four supported
// strategies. Client component -- imports only PURE lib/paper-trading
// modules (types/validation/pricing/capital), never lib/paper-trading's
// index.ts barrel or service.ts, so ioredis (Node-only) is never pulled
// into the client bundle. No live Trade/Submit Order language anywhere.

'use client';

import { useMemo, useState } from 'react';
import { validateTicket } from '@/lib/paper-trading/validation';
import { computeMarketableFill, oldestQuoteAgeSeconds, isStale, STALE_QUOTE_THRESHOLD_SECONDS } from '@/lib/paper-trading/pricing';
import { computeCapitalRequirement } from '@/lib/paper-trading/capital';
import type { PaperLeg, PaperOptionType, PaperStrategy } from '@/lib/paper-trading/types';

interface LegTemplate {
  legId: string;
  label: string;
  optionType: PaperOptionType;
  openAction: PaperLeg['openAction'];
}

const STRATEGY_TEMPLATES: Record<PaperStrategy, LegTemplate[]> = {
  CSP: [{ legId: 'short-put', label: 'Short Put', optionType: 'put', openAction: 'sell_to_open' }],
  BPS: [
    { legId: 'short-put', label: 'Short Put (higher strike)', optionType: 'put', openAction: 'sell_to_open' },
    { legId: 'long-put', label: 'Long Put (lower strike)', optionType: 'put', openAction: 'buy_to_open' },
  ],
  BCS: [
    { legId: 'short-call', label: 'Short Call (lower strike)', optionType: 'call', openAction: 'sell_to_open' },
    { legId: 'long-call', label: 'Long Call (higher strike)', optionType: 'call', openAction: 'buy_to_open' },
  ],
  IC: [
    { legId: 'short-put', label: 'Short Put (higher strike)', optionType: 'put', openAction: 'sell_to_open' },
    { legId: 'long-put', label: 'Long Put (lower strike)', optionType: 'put', openAction: 'buy_to_open' },
    { legId: 'short-call', label: 'Short Call (lower strike)', optionType: 'call', openAction: 'sell_to_open' },
    { legId: 'long-call', label: 'Long Call (higher strike)', optionType: 'call', openAction: 'buy_to_open' },
  ],
};

interface LegFormState {
  strike: string;
  bid: string;
  ask: string;
}

function emptyLegState(): LegFormState {
  return { strike: '', bid: '', ask: '' };
}

// datetime-local inputs are wall-clock LOCAL time with no timezone info --
// formatting via toISOString() (UTC) and reparsing via `new Date(str)` (which
// interprets a Z-less string as LOCAL) silently shifts the represented
// moment by the local UTC offset outside of UTC. Format from local
// getters instead so the round trip through the input is exact.
function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowLocalDateTime(): string {
  return formatLocalDateTime(new Date());
}

export default function PaperTicketForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [strategy, setStrategy] = useState<PaperStrategy>('CSP');
  const [symbol, setSymbol] = useState('');
  const [expiration, setExpiration] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [legState, setLegState] = useState<Record<string, LegFormState>>({});
  const [quoteObservedAt, setQuoteObservedAt] = useState(nowLocalDateTime());
  const [staleConfirmed, setStaleConfirmed] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [manualPrice, setManualPrice] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [entryRationale, setEntryRationale] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const template = STRATEGY_TEMPLATES[strategy];

  function legFor(legId: string): LegFormState {
    return legState[legId] ?? emptyLegState();
  }

  function updateLeg(legId: string, patch: Partial<LegFormState>) {
    setLegState((prev) => ({ ...prev, [legId]: { ...emptyLegState(), ...prev[legId], ...patch } }));
    setIdempotencyKey(null);
  }

  const legs: PaperLeg[] = useMemo(() => {
    return template.map((t) => ({
      legId: t.legId,
      optionType: t.optionType,
      strike: Number(legFor(t.legId).strike),
      expiration,
      openAction: t.openAction,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, legState, expiration]);

  const quoteTimestampIso = useMemo(() => {
    const d = new Date(quoteObservedAt);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }, [quoteObservedAt]);

  const quoteSnapshot = useMemo(() => {
    if (!quoteTimestampIso) return null;
    return {
      source: 'manual' as const,
      legs: template.map((t) => {
        const s = legFor(t.legId);
        return {
          legId: t.legId,
          bid: s.bid === '' ? null : Number(s.bid),
          ask: s.ask === '' ? null : Number(s.ask),
          mid: s.bid !== '' && s.ask !== '' ? (Number(s.bid) + Number(s.ask)) / 2 : null,
          quoteTimestamp: quoteTimestampIso,
        };
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, legState, quoteTimestampIso]);

  const ageSeconds = quoteSnapshot ? oldestQuoteAgeSeconds(quoteSnapshot, new Date()) : null;
  const stale = isStale(ageSeconds);

  const preview = useMemo(() => {
    if (manualOverride) return null;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0 || !quoteSnapshot) return null;
    const allPriced = template.every((t) => {
      const s = legFor(t.legId);
      return s.strike !== '' && s.bid !== '' && s.ask !== '';
    });
    if (!allPriced) return null;
    try {
      const fill = computeMarketableFill(legs, quoteSnapshot, 'open', qty, 100);
      const capital = computeCapitalRequirement(strategy, legs, qty, 100, fill.netValue);
      return { entryCredit: fill.netValue, mid: fill.midNetValue, slippage: fill.slippage, ...capital };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, quoteSnapshot, quantity, strategy, manualOverride]);

  function beginSubmission(): string {
    if (idempotencyKey) return idempotencyKey;
    const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `key_${Date.now()}_${Math.random()}`;
    setIdempotencyKey(key);
    return key;
  }

  async function handleSubmit() {
    setErrorMsg(null);
    if (!confirmed) {
      setErrorMsg('Please confirm this is a PAPER simulation before submitting.');
      return;
    }
    try {
      validateTicket({ symbol, strategy, expiration, quantity: Number(quantity), legs });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Invalid ticket.');
      return;
    }
    if (manualOverride && (!manualPrice || !manualReason)) {
      setErrorMsg('Manual Paper Fill requires a price and a reason.');
      return;
    }
    if (stale && !manualOverride && !staleConfirmed) {
      setErrorMsg('This quote appears stale. Please confirm before proceeding.');
      return;
    }

    const key = beginSubmission();
    setSubmitting(true);
    try {
      const res = await fetch('/api/paper-trading/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: key,
          symbol,
          strategy,
          expiration,
          quantity: Number(quantity),
          legs,
          quoteSnapshot: manualOverride ? quoteSnapshot : quoteSnapshot,
          staleConfirmed,
          manualOverride: manualOverride
            ? { manualPrice: Number(manualPrice), reason: manualReason, confirmedAt: new Date().toISOString(), confirmedByUser: 'dean' }
            : null,
          entryRationale: entryRationale || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorMsg(body?.error ?? 'Failed to add paper position.');
        return;
      }
      setSymbol('');
      setExpiration('');
      setQuantity('1');
      setLegState({});
      setConfirmed(false);
      setIdempotencyKey(null);
      onSubmitted();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="text-lg font-semibold text-white">Add Paper Position</h2>
      <p className="mt-1 text-xs text-slate-400">Manual simulation only. Nothing here reaches a broker.</p>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <label className="text-xs text-slate-400">
          Strategy
          <select
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
            value={strategy}
            onChange={(e) => {
              setStrategy(e.target.value as PaperStrategy);
              setLegState({});
              setIdempotencyKey(null);
            }}
          >
            <option value="CSP">Cash-Secured Put</option>
            <option value="BPS">Bull Put Spread</option>
            <option value="BCS">Bear Call Spread</option>
            <option value="IC">Iron Condor</option>
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Symbol
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
            value={symbol}
            onChange={(e) => {
              setSymbol(e.target.value.toUpperCase());
              setIdempotencyKey(null);
            }}
            placeholder="SPY"
          />
        </label>
        <label className="text-xs text-slate-400">
          Expiration
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
            value={expiration}
            onChange={(e) => {
              setExpiration(e.target.value);
              setIdempotencyKey(null);
            }}
          />
        </label>
        <label className="text-xs text-slate-400">
          Quantity
          <input
            type="number"
            min={1}
            step={1}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value);
              setIdempotencyKey(null);
            }}
          />
        </label>
      </div>

      <div className="mt-4 space-y-2">
        {template.map((t) => {
          const s = legFor(t.legId);
          return (
            <div key={t.legId} className="grid grid-cols-4 items-end gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2">
              <span className="text-xs text-slate-300">{t.label}</span>
              <label className="text-[10px] text-slate-500">
                Strike
                <input
                  type="number"
                  className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                  value={s.strike}
                  onChange={(e) => updateLeg(t.legId, { strike: e.target.value })}
                />
              </label>
              <label className="text-[10px] text-slate-500">
                Bid
                <input
                  type="number"
                  className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                  value={s.bid}
                  onChange={(e) => updateLeg(t.legId, { bid: e.target.value })}
                />
              </label>
              <label className="text-[10px] text-slate-500">
                Ask
                <input
                  type="number"
                  className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                  value={s.ask}
                  onChange={(e) => updateLeg(t.legId, { ask: e.target.value })}
                />
              </label>
            </div>
          );
        })}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-xs text-slate-400">
          Quote observed at
          <input
            type="datetime-local"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
            value={quoteObservedAt}
            onChange={(e) => {
              setQuoteObservedAt(e.target.value);
              setIdempotencyKey(null);
            }}
          />
        </label>
        <label className="text-xs text-slate-400">
          Entry rationale (optional)
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
            value={entryRationale}
            onChange={(e) => setEntryRationale(e.target.value)}
          />
        </label>
      </div>

      {stale && !manualOverride && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-100">
          <p>
            This quote is {ageSeconds != null ? Math.round(ageSeconds / 60) : '?'} minute(s) old (threshold: {Math.round(STALE_QUOTE_THRESHOLD_SECONDS / 60)}
            min). It will be labeled &ldquo;stale confirmed&rdquo; in the audit trail.
          </p>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={staleConfirmed} onChange={(e) => setStaleConfirmed(e.target.checked)} />
            I confirm I want to use this stale quote.
          </label>
        </div>
      )}

      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={manualOverride}
            onChange={(e) => {
              setManualOverride(e.target.checked);
              setIdempotencyKey(null);
            }}
          />
          Manual Paper Fill (override simulated pricing entirely -- for use outside market hours)
        </label>
        {manualOverride && (
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <label className="text-[10px] text-slate-500">
              Manual fill price (net, total $ for the whole position)
              <input
                type="number"
                className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
              />
            </label>
            <label className="text-[10px] text-slate-500">
              Reason
              <input
                className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {preview && (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs md:grid-cols-4">
          <div>
            <p className="text-slate-500">Mid Credit</p>
            <p className="text-white">{preview.mid != null ? `$${preview.mid.toFixed(2)}` : '—'}</p>
          </div>
          <div>
            <p className="text-slate-500">Simulated Fill Credit</p>
            <p className="text-white">${preview.entryCredit.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-slate-500">Capital Required</p>
            <p className="text-white">${preview.reservedCapital.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-slate-500">Max Loss</p>
            <p className="text-white">${preview.theoreticalMaxLoss.toFixed(2)}</p>
          </div>
        </div>
      )}

      {errorMsg && <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-950/30 p-2 text-xs text-rose-200">{errorMsg}</p>}

      <label className="mt-4 flex items-center gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        I understand this creates a <span className="font-semibold text-amber-400">PAPER</span> position only -- no real order is placed.
      </label>

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Simulating…' : 'Simulate Paper Fill'}
      </button>
    </section>
  );
}
