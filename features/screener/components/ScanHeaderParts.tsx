// features/screener/components/ScanHeaderParts.tsx
//
// SCAN-HEADER-0001: the two pieces every scan header shares, so Ranked spreads, Targeted,
// CSP, covered call, PMCC and LEAPS say the same things in the same words. Pure presentational.

'use client';

/** "3m ago" / "2h ago": the age of the scan's data, counted from when the scan finished. */
export function formatScanAge(completedAt: number, now: number = Date.now()): string {
  const mins = Math.max(0, Math.round((now - completedAt) / 60000));
  return mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
}

export interface ScanProvenanceChipProps {
  /** Epoch ms when the scan finished (the results' age is measured from here). */
  completedAt: number;
  /** True when the results were reloaded from storage rather than kept from this session. */
  restored: boolean;
}

export function ScanProvenanceChip({ completedAt, restored }: ScanProvenanceChipProps) {
  const title = restored
    ? 'Results restored from your last completed scan. Rescan to refresh.'
    : 'Results from this session\'s scan. Rescan to refresh.';
  return (
    <span className="text-purple-400 border border-purple-700 rounded px-1.5 py-0.5 text-[9px]" title={title} data-testid="scan-provenance-chip">
      {restored ? '↺' : '⚡'} scan{' '}
      <span className="text-purple-500/70">{formatScanAge(completedAt)}</span>
    </span>
  );
}

export interface QualificationCountsProps {
  qualified: number;
  /** Shown only when provided (scans that have a Caution state). */
  caution?: number;
  disqualified: number;
  disqualifiedLabel?: string;
  textFaintClassName?: string;
}

/** The decision-tier lead of every scan header: how many qualified, how many did not. */
export function QualificationCounts({ qualified, caution, disqualified, disqualifiedLabel = 'DISQUALIFIED', textFaintClassName = 'text-slate-500' }: QualificationCountsProps) {
  return (
    <>
      <span className="text-emerald-500">{qualified} QUALIFIED</span>
      {caution != null && <span className="text-amber-500">{caution} CAUTION</span>}
      <span className={textFaintClassName}>{disqualified} {disqualifiedLabel}</span>
    </>
  );
}
