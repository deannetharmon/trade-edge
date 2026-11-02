// features/screener/components/WhyRanksHerePanel.tsx
'use client';

// SCAN-TOP-0001 -- the Best Opportunities strip is gone; its "View details" reasoning lives on the
// qualified card itself. Collapsed by default (the card does not grow), and any portfolio conflict stays
// visible on the collapsed line so risk is never hidden behind the toggle. Opens in place across three
// columns. Everything shown is the advisor's own output (BestOpportunityRow), never recomputed here.

import { useId, useState } from 'react';
import type { BestOpportunityRow } from '@/features/screener/lib/bestOpportunityRows';

export interface WhyRanksHerePanelProps {
  row: BestOpportunityRow;
  borderClassName?: string;
  textFaintClassName?: string;
  textMutedClassName?: string;
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{title}</div>
      {children}
    </div>
  );
}

export function WhyRanksHerePanel({
  row,
  borderClassName = 'border-slate-700',
  textFaintClassName = 'text-slate-500',
  textMutedClassName = 'text-slate-300',
}: WhyRanksHerePanelProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const why = [row.primaryReason, ...row.supportingFactors.map(f => `+ ${f}`)].filter(Boolean);
  const risk: Array<{ text: string; className: string }> = [
    ...row.riskTradeoffs.map(f => ({ text: `~ ${f}`, className: 'text-amber-400/90' })),
    ...row.rejectionReasons.map(f => ({ text: `✕ ${f}`, className: 'text-red-400/90' })),
    ...row.missingInformationDisclosures.map(f => ({ text: `? ${f}`, className: `${textFaintClassName} italic` })),
  ];
  const portfolio: Array<{ text: string; className: string }> = [
    ...row.portfolioConflicts.map(f => ({ text: `⚠ ${f}`, className: 'text-blue-400/90' })),
    ...row.exposureDisclosures.map(f => ({ text: `ℹ ${f}`, className: textFaintClassName })),
  ];
  const improve = row.whatWouldImprove.join(' ');

  // The advisor gave this candidate nothing to say: show nothing, never a placeholder.
  if (why.length === 0 && risk.length === 0 && portfolio.length === 0 && !improve) return null;

  const hasConflict = row.portfolioConflicts.length > 0;

  return (
    <div data-testid="why-ranks-here" className={`mt-1 rounded-lg border ${borderClassName} px-3 py-1.5`}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(v => !v)}
          className="text-[11px] text-sky-400 hover:text-sky-300"
        >
          {open ? '▾' : '▸'} Why this ranks here
        </button>
        {hasConflict && <span data-testid="why-conflict-marker" className="text-[11px] text-blue-400">⚠ Portfolio conflict</span>}
      </div>
      {open && (
        <div id={panelId} className={`mt-2 grid grid-cols-1 gap-x-6 gap-y-3 border-t ${borderClassName} pt-2 text-[11px] leading-relaxed md:grid-cols-3`}>
          {why.length > 0 && (
            <Column title="Why it ranks here">
              {why.map((t, i) => <div key={i} className={i === 0 ? textMutedClassName : textFaintClassName}>{t}</div>)}
            </Column>
          )}
          {(risk.length > 0 || improve) && (
            <Column title="Risk and tradeoffs">
              {risk.map((r, i) => <div key={i} className={r.className}>{r.text}</div>)}
              {improve && <div className={`${textFaintClassName} italic`}>Would improve with: {improve}</div>}
            </Column>
          )}
          {portfolio.length > 0 && (
            <Column title="Portfolio and capital">
              {portfolio.map((r, i) => <div key={i} className={r.className}>{r.text}</div>)}
            </Column>
          )}
        </div>
      )}
    </div>
  );
}
