// features/screener/components/scanConfig/LifecycleDot.tsx
//
// SCAN-MODAL-UX-0001: the compact stand-in for LifecycleTag. A colored dot marks what the engine does with
// a control; the legend (ScanLegend) decodes the colors, and the same tag text LifecycleTag shows
// ("SEARCH RANGE · RESCAN", "GATE · FIXED") stays in the page for screen readers.

import type { Lifecycle } from '@/lib/screener/scanConfig/types';
import { lifecycleTagText } from './LifecycleTag';

export const DOT_CLASS: Record<Lifecycle, string> = {
  fetch: 'bg-blue-400',
  gate: 'bg-amber-400',
  rank: 'bg-purple-400',
  advisory: 'border border-neutral-300',
  'result-filter': 'bg-teal-400',
  'read-only': 'border border-neutral-500',
};

export function LifecycleDot({ lifecycle, fixed = false, rescan = false, visual = true, text = true }: {
  lifecycle: Lifecycle;
  fixed?: boolean;
  rescan?: boolean;
  /** Draw the dot. False renders the screen-reader text only. */
  visual?: boolean;
  /** Include the screen-reader text. False renders a decorative dot. */
  text?: boolean;
}) {
  return (
    <>
      {visual && <span aria-hidden="true" data-lifecycle={lifecycle} className={`mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full align-middle ${DOT_CLASS[lifecycle]}`} />}
      {text && <span className="sr-only">{lifecycleTagText(lifecycle, fixed, rescan)}</span>}
    </>
  );
}
