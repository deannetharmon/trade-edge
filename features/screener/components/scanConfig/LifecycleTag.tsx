import { LIFECYCLE_TAG_LABEL, type Lifecycle } from '@/lib/screener/scanConfig/types';

const TAG_CLASS: Record<Lifecycle, string> = {
  fetch: 'border-blue-500/60 bg-blue-500/10 text-blue-300',
  gate: 'border-amber-500/60 bg-amber-500/10 text-amber-300',
  rank: 'border-purple-400/60 bg-purple-500/10 text-purple-300',
  advisory: 'border-neutral-500/60 bg-neutral-500/10 text-neutral-300',
  'result-filter': 'border-teal-500/60 bg-teal-500/10 text-teal-300',
  'read-only': 'border-neutral-500/60 bg-neutral-500/10 text-neutral-300',
};

/**
 * The lifecycle tag beside a control: what the engine does with the value.
 * Text always carries the meaning; color only reinforces it.
 */
export function LifecycleTag({ lifecycle, fixed = false, rescan = false }: { lifecycle: Lifecycle; fixed?: boolean; rescan?: boolean }) {
  const parts = [LIFECYCLE_TAG_LABEL[lifecycle]];
  // Read-only and result-filter rows are not settings, so "fixed" would say nothing.
  if (fixed && lifecycle !== 'result-filter' && lifecycle !== 'read-only') parts.push('FIXED');
  // A fixed limit cannot be changed, so it never asks for a rescan.
  if (lifecycle === 'fetch' && rescan && !fixed) parts.push('RESCAN');
  return (
    <span data-lifecycle={lifecycle} className={`ml-2 inline-block whitespace-nowrap rounded-full border px-2 py-0.5 align-middle text-[9px] font-bold tracking-wider ${TAG_CLASS[lifecycle]}`}>
      {parts.join(' · ')}
    </span>
  );
}
