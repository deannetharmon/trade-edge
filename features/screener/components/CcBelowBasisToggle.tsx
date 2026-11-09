// features/screener/components/CcBelowBasisToggle.tsx
//
// CC-VISIBILITY-0001 -- on a covered-call result that found nothing because the cost-basis floor is above the price,
// say so with the numbers and offer the per-position "allow strikes below my basis" opt-in right here, so the trader
// never has to find it on the Portfolio tab. Same store as CcBasisEditor (useCcBasisSettings), so the two stay in sync.
// Default stays OFF; saving does not rescan, so it says to rescan. Nothing here places an order.

'use client';

import { useState } from 'react';
import { ccFloorExplanation } from '@/lib/scans/ccBrief';
import { normalizeCcBasisSymbol } from '@/lib/ccBasis/ccBasisSettings';
import { useCcBasisSettings } from '../useCcBasisSettings';

const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

export function CcBelowBasisToggle({ symbol, floor, price, allowBelowBasis }: { symbol: string; floor: number | null; price: number | null; allowBelowBasis: boolean }) {
  const { settings, save } = useCcBasisSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = normalizeCcBasisSymbol(symbol);
  const entry = key ? settings[key] : undefined;
  const saved = entry?.allowBelowBasis === true;
  // Hidden unless the floor is what blocked this result (and it has not been opted into at scan time).
  const explanation = ccFloorExplanation({ floor, price, allowBelowBasis });
  if (!explanation || !key) return null;

  const change = async (next: boolean) => {
    setBusy(true); setError(null);
    const ok = await save(symbol, next || (entry?.basis ?? null) !== null ? { basis: entry?.basis ?? null, allowBelowBasis: next } : null);
    setBusy(false);
    if (!ok) setError('Could not save. Try again.');
  };

  const id = `cc-allow-${key}`;
  return (
    <div data-testid={`cc-below-basis-${key}`} className="mt-1 space-y-1 text-[10px]">
      <p className="text-amber-300">{explanation}</p>
      <label htmlFor={id} className="flex items-start gap-2 text-slate-200">
        <input id={id} type="checkbox" checked={saved} disabled={busy} onChange={e => void change(e.target.checked)} className="mt-0.5 h-4 w-4" />
        <span>
          <b>Allow below-basis calls for {symbol}</b>
          {price !== null ? ` (scan from ${usd(price)}; a loss if called away)` : ' (a loss if called away)'}
        </span>
      </label>
      {saved && <p role="status" className="text-teal-300">Saved. Rescan to apply. The order window still asks you to acknowledge the loss.</p>}
      {error && <p role="alert" className="text-amber-300">{error}</p>}
    </div>
  );
}
