// features/screener/components/scanConfig/ScanLegend.tsx
//
// SCAN-MODAL-UX-0001: one line that decodes the dots beside each control. It lists only the kinds of control
// the modal actually shows, plus the after-scan note when the strategy has one.

import type { Lifecycle } from '@/lib/screener/scanConfig/types';
import { DOT_CLASS } from './LifecycleDot';
import { InfoTip } from './InfoTip';

const LEGEND_ORDER: Array<[Lifecycle, string]> = [
  ['fetch', 'Search range'], ['gate', 'Gate'], ['rank', 'Preference'], ['advisory', 'Advisory'],
];

export function ScanLegend({ lifecycles, afterScan }: {
  lifecycles: readonly Lifecycle[];
  /** The after-scan result-filter note, when this mode has one. `attr` is the registry data attribute. */
  afterScan?: { attr: Record<string, string>; hint: string };
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-400" data-testid="scan-legend">
      {LEGEND_ORDER.filter(([lifecycle]) => lifecycles.includes(lifecycle)).map(([lifecycle, label]) => (
        <span key={lifecycle} className="inline-flex items-center">
          <span aria-hidden="true" className={`mr-1.5 inline-block h-2 w-2 rounded-full ${DOT_CLASS[lifecycle]}`} />{label}
        </span>
      ))}
      {afterScan && (
        <span {...afterScan.attr} className="inline-flex items-center">
          <span className="sr-only">RESULT FILTER</span>
          <span aria-hidden="true" className={`mr-1.5 inline-block h-2 w-2 rounded-full ${DOT_CLASS['result-filter']}`} />Adjust after scan
          <InfoTip align="right">{afterScan.hint}</InfoTip>
        </span>
      )}
      <span>Changing any setting here needs a new scan.</span>
    </div>
  );
}
