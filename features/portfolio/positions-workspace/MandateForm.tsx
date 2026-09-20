// features/portfolio/positions-workspace/MandateForm.tsx
//
// LEAPS-MANDATE-0001 -- the one-screen "income rules" form for a held LEAPS. Saves through /api/leaps-mandate, which validates the
// values and confirms server-side that the signed-in user's broker account holds this contract. Nothing here places an order.

import { useState, type FormEvent } from 'react';
import type { LeapsMandate } from '@/lib/leaps-position-intelligence/types';
import { MIN_UPSIDE_PARTICIPATION } from '@/lib/leaps-position-intelligence/policy';

export function MandateForm({ underlyingSymbol, longOccSymbol, accountNumber, breakeven, initial, onSaved, onCancel }: {
  underlyingSymbol: string;
  longOccSymbol: string;
  accountNumber: string;
  breakeven: number | null;
  initial: LeapsMandate | null;
  onSaved: (mandate: LeapsMandate) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState(initial?.thesisTargetHigh != null ? String(initial.thesisTargetHigh) : '');
  const [floor, setFloor] = useState(initial?.incomeCapStrike != null ? String(initial.incomeCapStrike) : '');
  const [posture, setPosture] = useState<LeapsMandate['posture']>(initial?.posture ?? 'balanced');
  const [allowEarnings, setAllowEarnings] = useState(initial?.allowKnownEarningsCycle ?? false);
  const [invalidation, setInvalidation] = useState(initial?.invalidationPrice != null ? String(initial.invalidationPrice) : '');
  const [minCredit, setMinCredit] = useState(initial?.minimumCycleCredit != null ? String(initial.minimumCycleCredit) : '');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setErrors([]);
    try {
      const response = await fetch('/api/leaps-mandate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          underlyingSymbol, longOccSymbol, accountLocator: accountNumber, requestId: crypto.randomUUID(),
          mandate: { thesisTargetHigh: target, incomeCapStrike: floor, posture, allowKnownEarningsCycle: allowEarnings, invalidationPrice: invalidation, minimumCycleCredit: minCredit },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setErrors(Array.isArray(body?.errors) && body.errors.length > 0 ? body.errors : [typeof body?.error === 'string' ? body.error : `Could not save (${response.status})`]); return; }
      onSaved(body.mandate as LeapsMandate);
    } catch {
      setErrors(['Could not save your income rules. Check your connection and try again.']);
    } finally { setSaving(false); }
  };

  const field = 'mt-1 w-full rounded border border-white/15 bg-black/30 px-2 py-1 text-xs text-white';
  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded border border-white/10 p-3" data-testid="income-rules-form" aria-label={`Income rules for ${underlyingSymbol}`}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[10px] text-neutral-400">Target price
          <input inputMode="decimal" className={field} value={target} onChange={e => setTarget(e.target.value)} placeholder="where you expect this stock to be strong" />
        </label>
        <label className="text-[10px] text-neutral-400">Income floor strike
          <input inputMode="decimal" className={field} value={floor} onChange={e => setFloor(e.target.value)} placeholder={breakeven != null ? `blank = your breakeven $${(Math.round(breakeven * 100) / 100).toString()}` : 'blank = your breakeven'} />
        </label>
        <label className="text-[10px] text-neutral-400">Posture
          <select className={field} value={posture} onChange={e => setPosture(e.target.value as LeapsMandate['posture'])}>
            <option value="upside-first">Upside first: keep {MIN_UPSIDE_PARTICIPATION['upside-first']}% of the way to target</option>
            <option value="balanced">Balanced: keep {MIN_UPSIDE_PARTICIPATION.balanced}%</option>
            <option value="income-first">Income first: keep {MIN_UPSIDE_PARTICIPATION['income-first']}%</option>
          </select>
        </label>
        <label className="flex items-end gap-2 pb-1 text-[10px] text-neutral-300">
          <input type="checkbox" checked={allowEarnings} onChange={e => setAllowEarnings(e.target.checked)} />
          Allow selling a call through earnings
        </label>
        <label className="text-[10px] text-neutral-400">Invalidation price (optional)
          <input inputMode="decimal" className={field} value={invalidation} onChange={e => setInvalidation(e.target.value)} placeholder="below this, reassess the thesis" />
        </label>
        <label className="text-[10px] text-neutral-400">Minimum credit per share (optional)
          <input inputMode="decimal" className={field} value={minCredit} onChange={e => setMinCredit(e.target.value)} placeholder="skip calls that pay less" />
        </label>
      </div>
      {errors.length > 0 && <ul role="alert" className="list-disc pl-4 text-[10px] text-red-300">{errors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="min-h-8 rounded border border-teal-500/50 px-3 text-[10px] text-teal-300 focus:ring-2 focus:ring-teal-400 disabled:opacity-40">{saving ? 'Saving…' : 'Save rules'}</button>
        <button type="button" onClick={onCancel} className="min-h-8 rounded border border-white/15 px-3 text-[10px] text-neutral-300">Cancel</button>
      </div>
    </form>
  );
}
