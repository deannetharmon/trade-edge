// components/paper-trading/PaperResetControl.tsx
//
// PT-0001 section 11.3: destructive reset with explicit confirmation.

'use client';

import { useState } from 'react';

export default function PaperResetControl({ onReset }: { onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [startingBalance, setStartingBalance] = useState('100000');
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleReset() {
    setErrorMsg(null);
    if (confirmText !== 'RESET') {
      setErrorMsg('Please enter the confirmation phrase exactly as shown before resetting.');
      return;
    }
    const balance = Number(startingBalance);
    if (!Number.isFinite(balance) || balance <= 0) {
      setErrorMsg('Starting balance must be a positive number.');
      return;
    }
    setSubmitting(true);
    try {
      const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `key_${Date.now()}`;
      const res = await fetch('/api/paper-trading/account/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: key, startingBalance: balance }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorMsg(body?.error ?? 'Failed to reset paper account.');
        return;
      }
      setOpen(false);
      setConfirmText('');
      onReset();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800">
        Reset Paper Account
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-rose-500/40 bg-rose-950/10 p-4">
      <p className="text-sm font-semibold text-rose-200">Reset Paper Account</p>
      <p className="mt-1 text-xs text-rose-200/70">
        This permanently clears every open and closed paper position and resets cash to a new starting balance. This cannot be undone. Your real
        positions, Trade Log, and broker data are never affected.
      </p>
      <label className="mt-3 block text-xs text-slate-400">
        New starting balance
        <input
          type="number"
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          value={startingBalance}
          onChange={(e) => setStartingBalance(e.target.value)}
        />
      </label>
      <label className="mt-3 block text-xs text-slate-400">
        Type RESET to confirm
        <input
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
        />
      </label>
      {errorMsg && <p className="mt-2 text-xs text-rose-300">{errorMsg}</p>}
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleReset}
          disabled={submitting}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
        >
          {submitting ? 'Resetting…' : 'Confirm Reset'}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
          Cancel
        </button>
      </div>
    </div>
  );
}
