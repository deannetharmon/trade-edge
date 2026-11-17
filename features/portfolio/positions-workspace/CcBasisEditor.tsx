// features/portfolio/positions-workspace/CcBasisEditor.tsx
//
// CC-WHEEL-0001 S2b -- the "Basis for covered calls" line on a stock holding. Shows which cost basis the covered-call
// scan will use and where it came from (typed by you, after put premium, or the broker's), through the same resolver the
// scan uses (CC-PMCC-GUIDANCE-0001 R3), and lets the trader type one. There is no below-basis opt-in. Nothing here places an order.

import { useState } from 'react';
import { money } from '@/lib/leaps-analysis/dashboard';
import { normalizeCcBasisSymbol, resolveCcBasis } from '@/lib/ccBasis/ccBasisSettings';
import { useCcBasisSettings } from '@/features/screener/useCcBasisSettings';
import { useCcAdjustedBasis } from '@/features/screener/useCcAdjustedBasis';

type Theme = { border: string; textFaint: string };

export function CcBasisEditor({ symbol, brokerBasis, shares = null, th }: { symbol: string; brokerBasis: number | null; /** Shares held; lets the line show the basis after put premium, as the scan does. */ shares?: number | null; th: Theme }) {
  const { settings, save } = useCcBasisSettings();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const key = normalizeCcBasisSymbol(symbol);
  const entry = key ? settings[key] : undefined;
  const typed = entry?.basis ?? null;
  const adjustedBasis = useCcAdjustedBasis(symbol, shares, brokerBasis);
  const resolved = resolveCcBasis(settings, symbol, brokerBasis === null ? null : ({ costBasis: brokerBasis, costBasisComplete: true } as Parameters<typeof resolveCcBasis>[2]), adjustedBasis);

  const begin = () => {
    setDraft(entry?.basis != null ? String(entry.basis) : '');
    setError(null);
    setOpen(true);
  };

  const commit = async (clear: boolean) => {
    setError(null);
    let basis: number | null = null;
    if (!clear && draft.trim() !== '') {
      basis = Number(draft.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(basis) || basis <= 0) { setError('Enter a price above 0, or leave blank to use the broker basis.'); return; }
    }
    setBusy(true);
    const ok = await save(symbol, clear || basis === null ? null : { basis });
    setBusy(false);
    if (!ok) { setError('Could not save. Try again.'); return; }
    setOpen(false);
  };

  return (
    <div className="mt-1 font-sans text-[10px]" data-testid={`cc-basis-${symbol}`}>
      <span className={th.textFaint}>
        Calls use {resolved.basis !== null ? money(resolved.basis) : 'no basis'}
        {resolved.source ? ` (${resolved.source === 'typed' ? 'typed by you' : resolved.source === 'adjusted' ? 'after put premium' : 'broker'})` : ''}
      </span>{' '}
      {!open && <button type="button" onClick={begin} className="text-teal-300 underline focus:ring-2 focus:ring-teal-400">Edit</button>}
      {open && (
        <div className={`mt-1 space-y-1 rounded border p-2 ${th.border}`}>
          <label className="block">
            <span className={th.textFaint}>Your cost basis per share (e.g. after past premium)</span>
            <input
              aria-label={`${symbol} cost basis per share`}
              inputMode="decimal"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={brokerBasis !== null ? String(brokerBasis) : 'e.g. 82.00'}
              className="mt-0.5 block w-full rounded border border-white/20 bg-transparent px-1.5 py-1 font-mono text-white"
            />
          </label>
          {error && <p role="alert" className="text-amber-300">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void commit(false)} className="rounded border border-teal-500/50 px-2 py-1 text-teal-300 disabled:opacity-50">Save</button>
            <button type="button" disabled={busy} onClick={() => void commit(true)} className={`rounded border px-2 py-1 ${th.border}`}>Use broker basis</button>
            <button type="button" disabled={busy} onClick={() => setOpen(false)} className={th.textFaint}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
