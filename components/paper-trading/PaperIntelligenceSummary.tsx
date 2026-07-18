// components/paper-trading/PaperIntelligenceSummary.tsx
//
// PT-0001 section 13: focused summary over the canonical Portfolio
// Intelligence objectives for the PAPER portfolio only, produced by
// lib/paper-trading/adapters/portfolioIntelligenceAdapter.ts. Every
// objective rendered here already carries its own real-portfolio label
// conventions (priority/type/rationale) unchanged -- this component only
// adds the "PAPER" framing, never new logic.

'use client';

import { useEffect, useState } from 'react';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence/types';

export default function PaperIntelligenceSummary({ refreshToken }: { refreshToken: number }) {
  const [objectives, setObjectives] = useState<PortfolioObjective[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/paper-trading/intelligence');
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error ?? 'Failed to load paper portfolio intelligence.');
          return;
        }
        setObjectives(body.summary.objectives);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Network error.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Paper Portfolio Intelligence <span className="text-amber-400">(PAPER)</span>
      </h2>
      <p className="mt-1 text-xs text-slate-500">Same canonical Portfolio Intelligence rules used for real positions, evaluated against your paper positions only.</p>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {objectives && objectives.length > 0 && (
        <ul className="mt-3 space-y-2">
          {objectives.map((o) => (
            <li key={o.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs">
              <p className="font-semibold text-white">{o.title}</p>
              <p className="mt-1 text-slate-400">{o.rationale}</p>
              <p className="mt-1 text-slate-500">
                {o.type} · {o.priority} · {o.urgency}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
