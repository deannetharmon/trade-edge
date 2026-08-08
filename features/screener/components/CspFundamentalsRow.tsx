// features/screener/components/CspFundamentalsRow.tsx
//
// CSP-0002 — shared, single-leg CSP fundamentals summary. Originally lived
// only inside DisqualifiedSection.tsx, added there so a disqualified CSP
// audit card would never collapse into a reason-only row that hides the
// actual contract TradeEdge evaluated (the AMD production incident this
// ticket fixes).
//
// CSP-0002 corrective pass — "Complete the CSP metric presentation": the
// qualified ResultCard path (app/screener/page.tsx) only ever showed this
// same information inside its EXPANDED "CSP — Wheel Entry" section, which
// the corrective-pass review flagged as insufficient -- a viewer should not
// have to expand a card to see Bid/Ask/Mid/Cash required/Breakeven for a
// CSP result. Extracting this into one shared component, used by BOTH the
// qualified ResultCard and the disqualified audit card, guarantees the two
// paths show identical fundamentals and can never drift apart again.
//
// Never shows two-leg spread values (no long strike, no long-leg OI, no
// spread width) -- a CSP is a single short put, not a defined-risk spread
// with the long leg collapsed onto the short one.

import type { SpreadCandidate } from '@/lib/scans/types';

export interface CspFundamentalsRowProps {
  candidate: SpreadCandidate;
  /** Underlying price, used to compute OTM% the same way both cards already did. */
  price: number | null;
  textMutedClassName: string;
  /** Callers use different ids for the qualified vs. disqualified card, so
   * existing and new tests can scope queries to the right one. */
  testId: string;
}

export function CspFundamentalsRow({ candidate: c, price, textMutedClassName, testId }: CspFundamentalsRowProps) {
  if (c.strategy !== 'CSP') return null;
  const otmPct = price != null && price > 0 ? ((price - c.shortStrike) / price) * 100 : null;
  const creditPerShare = c.credit / 100;
  const oiWarn = c.cspOiPassing === false;
  // CSP-0002 corrective pass — display the exact mid csp-finder.ts used for
  // every formula (c.cspMid), never a locally recomputed (bid+ask)/2, so
  // the "Mid" shown here can never drift from the mid the math actually
  // used (see lib/scans/cspSearch.ts's deriveUsableMid).
  const mid = c.cspMid;
  return (
    <div className={`flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-1.5 text-[9px] ${textMutedClassName}`} data-testid={testId}>
      <span>Δ {c.shortDelta.toFixed(2)}</span>
      {c.pop != null && <span>POP {c.pop.toFixed(0)}%</span>}
      {otmPct != null && <span>OTM {otmPct.toFixed(1)}%</span>}
      {c.shortBid != null && c.shortAsk != null && (
        <span>Bid ${c.shortBid.toFixed(2)} · Ask ${c.shortAsk.toFixed(2)}</span>
      )}
      {mid != null && <span>Mid ${mid.toFixed(2)}</span>}
      <span>Credit/share ${creditPerShare.toFixed(2)}</span>
      <span>Premium/contract ${c.credit.toFixed(2)}</span>
      <span className={oiWarn ? 'text-amber-400/90' : undefined}>OI {c.shortOI}</span>
      {c.requiredCash != null && <span>Cash required ${c.requiredCash.toLocaleString()}</span>}
      {c.breakeven != null && <span>Breakeven ${c.breakeven.toFixed(2)}</span>}
      {c.roc != null && <span>ROC {c.roc.toFixed(1)}%</span>}
      {c.annualizedRoc != null && <span>Ann. ROC {c.annualizedRoc.toFixed(0)}%</span>}
      {c.cspOiWarning && (
        <span className="w-full text-amber-400/90">Warning: {c.cspOiWarning}</span>
      )}
      {/* CSP-WORKFLOW-0001 core-correction (BLOCKER-03) — the CSP score is the
          authoritative primary score for this candidate. Rounded to a whole
          number for display (never a long float); the raw per-dimension
          components stay inspectable via the title tooltip rather than being
          collapsed away. When any of the 9 required dimensions is missing,
          the score is UNAVAILABLE and this never fabricates a 0 or a
          renormalized partial number in its place. */}
      {c.cspScore && (
        c.cspScore.scoreStatus === 'AVAILABLE'
          ? (
            <span
              data-testid={`${testId}-csp-score`}
              title={`Score components (0-100 each): ${Object.entries(c.cspScore.components)
                .map(([k, v]) => `${k}=${v ?? 'n/a'}`)
                .join(', ')}`}
            >
              Score {Math.round(c.cspScore.total as number)}
            </span>
          )
          : (
            <span
              data-testid={`${testId}-csp-score`}
              className="text-amber-400/90"
              title={`Missing required inputs: ${c.cspScore.missingInputs.join(', ')}`}
            >
              Score unavailable
            </span>
          )
      )}
    </div>
  );
}
