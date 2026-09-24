import type { CspReceipt } from '@/lib/screener/scanConfig/cspRegistry';
import { IVR_UNAVAILABLE_NOTE } from '@/lib/screener/scanConfig/cspRegistry';
import type { CcReceipt } from '@/lib/screener/scanConfig/ccRegistry';
import type { ReceiptGroup } from '@/lib/screener/scanConfig/types';
import type { ScanModalTheme } from '../ScanModalShell';

/**
 * The grouped rows of a registry-built receipt. Shared by every strategy's scan summary and
 * result receipt, so the rows look and read the same everywhere.
 */
export function ReceiptRows({ th, groups, bare = false, children }: {
  th: ScanModalTheme;
  groups: ReceiptGroup[];
  /** True when the caller supplies the border, padding, and heading. */
  bare?: boolean;
  /** Extra rows (for example a Results row), rendered inside the same list. */
  children?: React.ReactNode;
}) {
  return (
    <dl className={`${bare ? '' : 'mt-2 '}grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]`}>
      {groups.map((group) => (
        <div key={group.key} className="contents">
          <dt className={`${th.textFaint} uppercase tracking-wide`}>{group.label}</dt>
          <dd className={th.text}>{group.items.join(' · ')}</dd>
        </div>
      ))}
      {children}
    </dl>
  );
}

function PanelShell({ th, heading, testId, bare, children }: {
  th: ScanModalTheme; heading: string; testId?: string; bare: boolean; children: React.ReactNode;
}) {
  // A bare panel sits inside a region the caller already labels, so it is a plain block, not a second region.
  if (bare) return <div data-testid={testId} className={`text-[10px] ${th.textMuted}`}>{children}</div>;
  return (
    <section aria-label={heading} data-testid={testId} className={`rounded-lg border ${th.border} p-3 text-[10px] ${th.textMuted}`}>
      <h3 className={`text-[11px] font-bold uppercase tracking-wider ${th.text}`}>{heading}</h3>
      {children}
    </section>
  );
}

/**
 * Renders a registry-built CSP receipt: the scan summary before a run, and the
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
    <PanelShell th={th} heading={heading} testId={testId} bare={bare}>
      <ReceiptRows th={th} groups={receipt.groups} bare={bare}>
        {counts && (
          <div className="contents">
            <dt className={`${th.textFaint} uppercase tracking-wide`}>Results</dt>
            <dd className={th.text}>
              {counts.qualified} qualified · {counts.targetedNearMisses} targeted near-miss{counts.targetedNearMisses === 1 ? '' : 'es'} · {counts.disqualified} disqualified
            </dd>
          </div>
        )}
      </ReceiptRows>
      {showLimits && <p className="mt-2 text-amber-300">{IVR_UNAVAILABLE_NOTE}</p>}
      {counts && counts.symbolsIvrUnavailable > 0 && (
        <p className="mt-2 text-amber-300">
          IVR unavailable for {counts.symbolsIvrUnavailable} symbol{counts.symbolsIvrUnavailable === 1 ? '' : 's'}: the IVR cap could not be verified, so they are disqualified.
        </p>
      )}
    </PanelShell>
  );
}

/**
 * SCREENER-CONFIG-0001B -- the covered-call scan summary and result receipt, from the CC registry.
 */
export function CcReceiptPanel({ th, receipt, heading, testId, bare = false }: {
  th: ScanModalTheme;
  receipt: CcReceipt;
  heading: string;
  testId?: string;
  bare?: boolean;
}) {
  const counts = receipt.counts;
  return (
    <PanelShell th={th} heading={heading} testId={testId} bare={bare}>
      <ReceiptRows th={th} groups={receipt.groups} bare={bare}>
        {counts && (
          <div className="contents">
            <dt className={`${th.textFaint} uppercase tracking-wide`}>Results</dt>
            <dd className={th.text}>
              {counts.symbolsWithCandidate} symbol{counts.symbolsWithCandidate === 1 ? '' : 's'} with a candidate · {counts.symbolsWithNone} with none
            </dd>
          </div>
        )}
      </ReceiptRows>
    </PanelShell>
  );
}
