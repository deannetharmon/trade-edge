// features/screener/components/CcDecideBoxes.tsx
'use client';

// CC-DECIDE-0001 slice A -- the two plain boxes on a qualified covered-call card: what to do, and the catch. Display only.

import { buildCcDecide, type CcDecideInput } from '@/lib/scans/ccDecide';

export function CcDecideBoxes({ input }: { input: CcDecideInput }) {
  const d = buildCcDecide(input);
  if (!d) return null;
  const below = d.catchKind === 'below-cost';
  return (
    <div className="space-y-2" data-testid="cc-decide" onClick={e => e.stopPropagation()}>
      <div className="rounded-lg border border-emerald-700 bg-emerald-500/10 px-3 py-2" data-testid="cc-decide-verdict">
        <p className="text-sm font-bold text-emerald-300">{d.headline}</p>
        <p className="mt-0.5 text-xs">{d.keepLine}</p>
      </div>
      <div className={`rounded-lg border px-3 py-2 ${below ? 'border-red-800 bg-red-500/10' : 'border-amber-800 bg-amber-500/10'}`} data-testid="cc-decide-catch">
        <p className={`text-[10px] font-bold ${below ? 'text-red-300' : 'text-amber-300'}`}>{d.catchLabel}</p>
        <p className="mt-0.5 text-xs">{d.catchText}</p>
      </div>
    </div>
  );
}
