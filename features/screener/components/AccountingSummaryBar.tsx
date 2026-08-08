// features/screener/components/AccountingSummaryBar.tsx
//
// SCREENER-UX-0001 — "Reconciled scan accounting," the second item in the
// required information hierarchy. Renders lib/screener/scanSession.ts's own
// computeSessionAccounting() output (never an independently-computed total —
// see Canonical state safeguards in the ticket) as individually labeled,
// tooltipped segments, so Selected/Planned/Attempted/Evaluated/Failed/
// Skipped/Qualified/Disqualified are each independently legible instead of
// one opaque joined string. Zero-value Failed/Skipped segments are hidden,
// matching formatSessionAccountingSummary's existing convention. Never
// renders a fraction like "2 of 2 qualified" — qualified/disqualified are
// each their own absolute count.

import { computeSessionAccounting, type ScreenerScanSession } from '@/lib/screener/scanSession';

export interface AccountingSummaryBarProps {
  session: ScreenerScanSession;
  borderClassName?: string;
  textFaintClassName?: string;
}

interface Segment {
  key: string;
  label: string;
  value: number;
  tooltip: string;
}

export function AccountingSummaryBar({
  session,
  borderClassName = 'border-slate-700',
  textFaintClassName = 'text-slate-500',
}: AccountingSummaryBarProps) {
  const a = computeSessionAccounting(session);

  const segments: Segment[] = [
    { key: 'selected', label: 'selected', value: a.selectedCount, tooltip: 'Selected: your normalized Opportunity Universe for this scan.' },
    { key: 'planned', label: 'planned', value: a.plannedCount, tooltip: 'Planned: the eligible subset of Selected that was actually scheduled to scan.' },
    { key: 'attempted', label: 'attempted', value: a.attemptedCount, tooltip: 'Attempted: Planned symbols the scan actually reached (Evaluated + Failed).' },
    { key: 'evaluated', label: 'evaluated', value: a.evaluatedCount, tooltip: 'Evaluated: symbols whose evaluation completed, with or without a qualifying candidate.' },
  ];
  // Hidden when zero — matches formatSessionAccountingSummary's convention;
  // a symbol reconciliation that never failed or skipped shouldn't clutter
  // the bar with "0 failed · 0 skipped."
  if (a.failedCount > 0) {
    segments.push({ key: 'failed', label: 'failed', value: a.failedCount, tooltip: 'Failed: Planned symbols the scan attempted but could not complete (e.g. a market-data request failure).' });
  }
  if (a.skippedCount > 0) {
    segments.push({ key: 'skipped', label: 'skipped', value: a.skippedCount, tooltip: 'Skipped: Selected but not Planned (excluded from scope), or left unresolved after a stop.' });
  }
  segments.push(
    { key: 'qualified', label: 'qualified', value: a.qualifiedCandidateCount, tooltip: 'Qualified: candidates that passed every scan-time qualification rule.' },
    { key: 'disqualified', label: 'disqualified', value: a.disqualifiedCandidateCount, tooltip: 'Disqualified: evaluated candidates that failed one or more scan-time qualification rules.' },
  );
  // CSP-WORKFLOW-0001 core correction (BLOCKER-01) — only shown when it
  // diverges from qualifiedCandidateCount (i.e. at least one market-
  // qualified candidate is not account-actionable, today only possible for
  // CSP), matching formatSessionAccountingSummary's own divergence-only
  // convention so every non-CSP-account-aware session's bar is unchanged.
  if (a.accountActionableCount !== a.qualifiedCandidateCount) {
    segments.push({
      key: 'account-actionable', label: 'account-actionable', value: a.accountActionableCount,
      tooltip: 'Account-actionable: market-qualified candidates that are ALSO affordable and verified for the selected account. A market-qualified candidate can be capital-insufficient, capital-unverified, or have no account selected and still count as Qualified above.',
    });
  }

  return (
    <div
      data-testid="accounting-summary-bar"
      role="group"
      aria-label="Scan accounting summary"
      className={`flex flex-wrap items-center gap-x-1 gap-y-0.5 border ${borderClassName} rounded px-1.5 py-0.5 text-[9px] ${textFaintClassName}`}
    >
      {segments.map((seg, i) => (
        <span key={seg.key} className="whitespace-nowrap">
          <span title={seg.tooltip} aria-label={`${seg.tooltip} Count: ${seg.value}.`}>
            {seg.value} {seg.label}
          </span>
          {i < segments.length - 1 && <span aria-hidden="true"> · </span>}
        </span>
      ))}
    </div>
  );
}
