// features/screener/components/PmccTickerDisclosure.tsx
//
// TE-0007H — Ian's real, priority addition alongside the ticker filter:
// "a per-ticker summary, before the AI feature, not after it... so I can
// decide which tickers deserve a closer look before I ever open a single
// card." Same real accessibility machinery as ExpirationDisclosure
// (useDisclosureA11y), not a copy of that component -- its header format
// is fixed to expiration/DTE, which doesn't fit a per-ticker summary at
// all, so this is a genuinely separate component with the right content
// rather than a forced reuse.

import { useId, type ReactNode } from 'react';
import { useDisclosureA11y } from '../lib/useDisclosureA11y';

export function PmccTickerDisclosure({
  symbol, price, candidateCount, bestWidthMinusDebitPct, bestAnnualizedRoiPct, bestScore, bestScoreLabel = 'Score', itemLabel = 'qualified structure', defaultOpen, borderClassName, children,
}: {
  symbol: string;
  price: number | null;
  candidateCount: number;
  bestWidthMinusDebitPct: number | null;
  bestAnnualizedRoiPct: number | null;
  // PMCC-CARD-SCORE-HEADER-0001 -- Diane's approved mockup: the group
  // header leads with score, matching the score badge already on every
  // individual PmccResultCard, instead of burying it after width/ROI.
  // Optional so the near-miss/audit call sites (which don't compute a
  // best score) need no changes -- omitted entirely when null/undefined,
  // same convention bestWidthMinusDebitPct/bestAnnualizedRoiPct already
  // use.
  bestScore?: number | null;
  bestScoreLabel?: string;
  // SCREENER-PMCC-DISQUALIFIED-GROUPING-0001 -- this component now also
  // groups the near-miss and audit sections (Dean's explicit ask: "It
  // should behave just like the qualified list"), which are not
  // "qualified structures." Defaults to the original wording so the
  // existing qualified-section call site needs no change.
  itemLabel?: string;
  defaultOpen: boolean;
  borderClassName: string;
  children: ReactNode;
}) {
  const panelId = useId();
  const countLabel = `${candidateCount} ${itemLabel}${candidateCount === 1 ? '' : 's'}`;
  const bestLine = [
    bestWidthMinusDebitPct != null ? `best width-minus-debit ${bestWidthMinusDebitPct.toFixed(1)}%` : null,
    bestAnnualizedRoiPct != null ? `best annualized ROI ${bestAnnualizedRoiPct.toFixed(1)}%` : null,
  ].filter((part): part is string => part != null).join(', ');
  const accessibleName = `${symbol}${bestScore != null ? `, score ${bestScore}` : ''}, ${countLabel}${bestLine ? `, ${bestLine}` : ''}`;
  const { open, toggle, buttonRef, liveMessage } = useDisclosureA11y(
    `${accessibleName} expanded`, `${accessibleName} collapsed`, defaultOpen,
  );
  return (
    <section className={`rounded-xl border ${borderClassName} p-2`} data-testid="pmcc-ticker-group">
      <button ref={buttonRef} type="button" aria-expanded={open} aria-controls={panelId}
        aria-label={accessibleName} onClick={toggle}
        className="flex w-full items-center justify-between text-left text-[10px] font-bold tracking-wider text-amber-300">
        <span className="flex items-center gap-2 flex-wrap">
          {bestScore != null && <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-300">{bestScoreLabel} {bestScore}</span>}
          <span>{symbol}</span>
          {price != null && <span className="text-white/50 font-normal">${price.toFixed(2)}</span>}
          <span className="font-normal">{countLabel}</span>
          {bestLine && <span className="font-normal text-white/50">{bestLine}</span>}
        </span>
        <span aria-hidden="true">{open ? '▾ Expanded' : '▸ Collapsed'}</span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">{liveMessage}</span>
      {open && <div id={panelId} className="mt-2 space-y-2">{children}</div>}
    </section>
  );
}

