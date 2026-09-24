import type { CspReceipt } from '@/lib/screener/scanConfig/cspRegistry';
import { IVR_UNAVAILABLE_NOTE } from '@/lib/screener/scanConfig/cspRegistry';
import type { ScanModalTheme } from '../ScanModalShell';

/**
 * Renders a registry-built receipt: the scan summary before a run, and the
 * result receipt after one. Both come from the same registry, so labels match.
 */
export function ScanReceiptPanel({ th, receipt, heading, testId, showLimits = false, bare = false }: {
  th: ScanModalTheme;
  receipt: CspReceipt;
  heading: string;
  testId?: string;
  /** True before a run: state the unavailable-IVR rule up front. */
  showLimits?: boolean;
  /** Render only the rows, with no border, padding, or heading (the caller supplies them). */
  bare?: boolean;
}) {
  const counts = receipt.counts;
  return (
    <section aria-label={heading} data-testid={testId} className={bare ? `text-[10px] ${th.textMuted}` : `rounded-lg border ${th.border} p-3 text-[10px] ${th.textMuted}`}>
      {!bare && <h3 className={`text-[11px] font-bold uppercase tracking-wider ${th.text}`}>{heading}</h3>}
      <dl className={`${bare ? '' : 'mt-2 '}grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]`}>
        {receipt.groups.map((group) => (
          <div key={group.key} className="contents">
            <dt className={`${th.textFaint} uppercase tracking-wide`}>{group.label}</dt>
            <dd className={th.text}>{group.items.join(' · ')}</dd>
          </div>
        ))}
        {counts && (
          <div className="contents">
            <dt className={`${th.textFaint} uppercase tracking-wide`}>Results</dt>
            <dd className={th.text}>
              {counts.qualified} qualified · {counts.targetedNearMisses} targeted near-miss{counts.targetedNearMisses === 1 ? '' : 'es'} · {counts.disqualified} disqualified
            </dd>
          </div>
        )}
      </dl>
      {showLimits && <p className="mt-2 text-amber-300">{IVR_UNAVAILABLE_NOTE}</p>}
      {counts && counts.symbolsIvrUnavailable > 0 && (
        <p className="mt-2 text-amber-300">
          IVR unavailable for {counts.symbolsIvrUnavailable} symbol{counts.symbolsIvrUnavailable === 1 ? '' : 's'}: the IVR cap could not be verified, so they are disqualified.
        </p>
      )}
    </section>
  );
}
