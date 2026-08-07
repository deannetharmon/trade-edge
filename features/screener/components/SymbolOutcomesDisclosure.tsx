// features/screener/components/SymbolOutcomesDisclosure.tsx
//
// SCREENER-UX-0001 — "Symbol-level failures and skips," item 7 in the
// required hierarchy. Reads session.symbolOutcomes directly (Task 1's own
// canonical per-symbol record — never re-derived or fabricated here) and
// groups every outcome that did NOT produce a real qualified/disqualified
// ScreenResult into the five required buckets: Failed, Excluded from scope,
// Cancelled, Superseded, No qualifying candidate. These are symbol
// outcomes, not candidates, and are rendered in their own disclosure,
// never mixed into the Disqualified section.

import { useId, useState } from 'react';
import {
  REASON_CODE_LABELS,
  type ScreenerReasonCode,
  type ScreenerScanSession,
  type ScreenerSymbolOutcome,
} from '@/lib/screener/scanSession';

export interface SymbolOutcomesDisclosureProps {
  session: ScreenerScanSession;
  borderClassName?: string;
  textFaintClassName?: string;
}

type GroupKey = 'failed' | 'excludedFromScope' | 'cancelled' | 'superseded' | 'noQualifyingCandidate';

const GROUP_LABELS: Record<GroupKey, string> = {
  failed: 'Failed',
  excludedFromScope: 'Excluded from scope',
  cancelled: 'Cancelled',
  superseded: 'Superseded',
  noQualifyingCandidate: 'No qualifying candidate',
};

const EXCLUDED_FROM_SCOPE_CODES: ReadonlySet<ScreenerReasonCode> = new Set<ScreenerReasonCode>([
  'EXCLUDED_BY_SCAN_SCOPE',
  'CC_NO_CAPACITY',
  'CC_NO_SHARES_OWNED',
  'CC_FULLY_COVERED',
  'CC_HIDDEN_BY_TRADER',
  'CC_HOLDINGS_UNAVAILABLE',
  'CC_UNATTRIBUTABLE_EXPOSURE',
  'ACCESS_TOKEN_UNAVAILABLE',
]);

function groupFor(outcome: ScreenerSymbolOutcome): GroupKey | null {
  if (outcome.status === 'evaluated') {
    // Only zero-candidate evaluations belong here — a real ScreenResult
    // already lives in the Qualified/Disqualified sections and must not be
    // duplicated into this disclosure.
    return outcome.candidateCount === 0 ? 'noQualifyingCandidate' : null;
  }
  if (outcome.status === 'failed') return 'failed';
  // status === 'skipped'
  if (outcome.reasonCode === 'CANCELLED') return 'cancelled';
  if (outcome.reasonCode === 'SUPERSEDED') return 'superseded';
  return 'excludedFromScope';
}

export function buildSymbolOutcomeGroups(
  session: ScreenerScanSession,
): Array<{ key: GroupKey; label: string; entries: Array<{ symbol: string; reasonLabel: string; reasonCode?: ScreenerReasonCode }> }> {
  const buckets: Record<GroupKey, Array<{ symbol: string; reasonLabel: string; reasonCode?: ScreenerReasonCode }>> = {
    failed: [], excludedFromScope: [], cancelled: [], superseded: [], noQualifyingCandidate: [],
  };
  for (const outcome of session.symbolOutcomes) {
    const key = groupFor(outcome);
    if (!key) continue;
    buckets[key].push({
      symbol: outcome.symbol,
      reasonLabel: outcome.reasonCode ? REASON_CODE_LABELS[outcome.reasonCode] : 'No reason recorded',
      reasonCode: outcome.reasonCode,
    });
  }
  return (Object.keys(buckets) as GroupKey[])
    .filter(key => buckets[key].length > 0)
    .map(key => ({ key, label: GROUP_LABELS[key], entries: buckets[key] }));
}

export function SymbolOutcomesDisclosure({
  session,
  borderClassName = 'border-slate-700',
  textFaintClassName = 'text-slate-500',
}: SymbolOutcomesDisclosureProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const groups = buildSymbolOutcomeGroups(session);
  const totalCount = groups.reduce((sum, g) => sum + g.entries.length, 0);

  if (totalCount === 0) return null;

  return (
    <section aria-label="Symbols not producing candidates" data-testid="symbol-outcomes-disclosure">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between text-[9px] tracking-widest uppercase font-bold ${textFaintClassName} py-1`}
      >
        <span>Symbols not producing candidates ({totalCount})</span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div id={panelId} className="space-y-2 mt-1">
          {groups.map(group => (
            <div key={group.key} className={`border ${borderClassName} rounded-lg p-2`}>
              <p className={`text-[9px] font-bold ${textFaintClassName} mb-1`}>{group.label} ({group.entries.length})</p>
              <ul className="space-y-0.5">
                {group.entries.map((entry, i) => (
                  <li key={`${entry.symbol}-${i}`} className="text-[9px]">
                    <span className="font-semibold">{entry.symbol}</span>
                    {' — '}
                    <span className={textFaintClassName}>{entry.reasonLabel}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
