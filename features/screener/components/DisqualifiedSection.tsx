// features/screener/components/DisqualifiedSection.tsx
//
// SCREENER-UX-0001 — "Disqualified candidates," item 6 in the required
// hierarchy: an audit trail, not a second Best-Opportunities list.
// Section-level collapse (default collapsed whenever qualified candidates
// exist, per the ticket) with a count in the heading; each candidate is
// itself collapsed by default, showing symbol/strategy/essential
// structure/primary reason/additional-failure count without expanding.
// Uses "Disqualified," never "Rejected" (no documented distinct product
// meaning for "rejected" in this codebase). Never uses a red badge alone —
// every collapsed card also carries the reason text.
//
// Corrective pass: every expand/collapse toggle here uses
// useDisclosureA11y, which adds a polite live-region announcement of the
// new state and returns focus to the trigger button on collapse (see that
// module's header for why).

import { useId } from 'react';
import type { ScreenResult } from '@/lib/scans/types';
import { useDisclosureA11y } from '../lib/useDisclosureA11y';
import { CspFundamentalsRow } from './CspFundamentalsRow';
import { ExpirationDisclosure } from './ExpirationDisclosure';

export interface DisqualifiedSectionProps {
  results: ScreenResult[];
  /** Whether qualified candidates exist alongside these — when true, the
   * section itself starts collapsed, per the ticket. */
  hasQualifiedCandidates: boolean;
  borderClassName?: string;
  textFaintClassName?: string;
  textMutedClassName?: string;
  groupByExpiration?: boolean;
}

function essentialStructure(result: ScreenResult): string {
  const c = result.bestCandidate;
  if (!c) return '—';
  if (c.strategy === 'CSP' || c.strategy === 'CC') return `${c.shortStrike} strike`;
  if (c.strategy === 'IC' && c.shortCallStrike != null) {
    return `${c.shortStrike}/${c.longStrike} · ${c.shortCallStrike}/${c.longCallStrike}`;
  }
  return `${c.shortStrike}/${c.longStrike}`;
}

function DisqualifiedCard({
  result,
  th,
}: {
  result: ScreenResult;
  th: { border: string; textFaint: string; textMuted: string };
}) {
  const panelId = useId();
  const candidateLabel = result.bestCandidate
    ? `${result.symbol} ${result.bestCandidate.expiration} ${result.bestCandidate.shortStrike} put`
    : result.symbol;
  const { open: expanded, toggle, buttonRef, liveMessage } = useDisclosureA11y(
    `${candidateLabel} checks expanded`,
    `${candidateLabel} checks collapsed`,
  );
  const [primaryReason, ...additional] = result.failReasons;
  const checkEntries = Object.entries(result.checks) as [string, ScreenResult['checks']['ivr']][];
  const failedChecks = checkEntries.filter(([, c]) => c.status === 'fail' || c.status === 'warn');

  return (
    <div className={`border ${th.border} rounded-lg overflow-hidden`}>
      <div className="flex items-center gap-3 px-3 py-2 text-[10px]">
        <span className="shrink-0 font-semibold w-14">{result.symbol}</span>
        <span className={`shrink-0 ${th.textFaint} w-10`}>{result.strategy}</span>
        <span className={`shrink-0 ${th.textFaint} w-28`}>{essentialStructure(result)}</span>
        {/* Never a bare color badge -- the reason text itself is always
            visible in the collapsed row, color is a secondary cue only. */}
        <span className="flex-1 text-amber-400/90 truncate" title={primaryReason}>
          {primaryReason ?? 'Did not qualify'}
        </span>
        {additional.length > 0 && (
          <span className={`shrink-0 ${th.textFaint}`}>+{additional.length} more</span>
        )}
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={toggle}
          aria-label={`${expanded ? 'Hide' : 'Show'} checks for ${candidateLabel}`}
          className={`shrink-0 text-[9px] px-2 py-1 border ${th.border} rounded ${th.textMuted} hover:border-slate-400`}
        >
          {expanded ? 'Hide checks' : 'Show checks'}
        </button>
      </div>
      {result.bestCandidate && (
        <CspFundamentalsRow
          candidate={result.bestCandidate}
          price={result.price}
          textMutedClassName={th.textMuted}
          testId="csp-disqualified-fundamentals"
        />
      )}
      {expanded && (
        <div id={panelId} className={`px-3 pb-3 space-y-1 border-t ${th.border} pt-2`}>
          {result.failReasons.map((reason, i) => (
            <p key={i} className="text-[9px] text-amber-400/90">✕ {reason}</p>
          ))}
          {failedChecks.map(([name, check]) => (
            <p key={name} className={`text-[9px] ${th.textFaint}`}>
              <span className="uppercase tracking-wide">{name}</span>: {check.value} — {check.reason}
            </p>
          ))}
        </div>
      )}
      <span role="status" aria-live="polite" className="sr-only">{liveMessage}</span>
    </div>
  );
}

export function DisqualifiedSection({
  results,
  hasQualifiedCandidates,
  borderClassName = 'border-slate-700',
  textFaintClassName = 'text-slate-500',
  textMutedClassName = 'text-slate-300',
  groupByExpiration = false,
}: DisqualifiedSectionProps) {
  const th = { border: borderClassName, textFaint: textFaintClassName, textMuted: textMutedClassName };
  const panelId = useId();
  const { open: sectionOpen, toggle: toggleSection, buttonRef, liveMessage } = useDisclosureA11y(
    'Disqualified section expanded',
    'Disqualified section collapsed',
    !hasQualifiedCandidates,
  );

  if (results.length === 0) return null;

  return (
    <section aria-label="Disqualified candidates" data-testid="disqualified-section">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={sectionOpen}
        aria-controls={panelId}
        onClick={toggleSection}
        className={`w-full flex items-center justify-between text-[9px] tracking-widest uppercase font-bold ${th.textFaint} py-1`}
      >
        <span>Disqualified ({results.length})</span>
        <span aria-hidden="true">{sectionOpen ? '▾' : '▸'}</span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">{liveMessage}</span>
      {sectionOpen && (
        <div id={panelId} className="space-y-2 mt-1">
          {groupByExpiration ? Array.from(results.reduce((groups, result) => {
            const expiration = result.bestCandidate?.expiration ?? 'Unknown expiration';
            const group = groups.get(expiration) ?? [];
            group.push(result); groups.set(expiration, group); return groups;
          }, new Map<string, ScreenResult[]>()).entries()).sort(([a], [b]) => a.localeCompare(b)).map(([expiration, group]) => (
            <ExpirationDisclosure key={expiration} expiration={expiration}
              dte={group[0]?.bestCandidate?.dte ?? null} candidateCount={group.length}
              kind="disqualified" defaultOpen={false} borderClassName={th.border}>
              {group.map(r => <DisqualifiedCard key={r.candidateId ?? `${r.symbol}-${r.strategy}`} result={r} th={th} />)}
            </ExpirationDisclosure>
          )) : results.map(r => (
            // CSP-WORKFLOW-0001 — candidateId (present for CSP results)
            // disambiguates multiple disqualified contracts on the same
            // symbol; other strategies fall back to symbol+strategy exactly
            // as before, since they still produce at most one disqualified
            // ScreenResult per symbol. Closes IMPORTANT-04.
            <DisqualifiedCard key={r.candidateId ?? `${r.symbol}-${r.strategy}`} result={r} th={th} />
          ))}
        </div>
      )}
    </section>
  );
}
