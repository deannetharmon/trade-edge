// features/screener/components/ActivePmccRules.tsx

import { formatPmccActiveRules, type PmccActiveRulesSnapshotLike, type PmccRulesEntryMode } from '@/lib/scans/pmccActiveRules';

/**
 * PMCC-RECEIPT-0001 part 1 -- ambient "Active PMCC rules" panel, same amber styling as
 * ActiveCcRules. Presentational: takes a plain scan snapshot, so it never reflects live controls.
 * Renders nothing without a snapshot. No edit button.
 */
export function ActivePmccRules({ snapshot, entryMode }: {
  snapshot: PmccActiveRulesSnapshotLike | null | undefined;
  entryMode?: PmccRulesEntryMode;
}) {
  const rules = formatPmccActiveRules(snapshot, entryMode);
  if (!rules) return null;
  return (
    <section aria-label="Active PMCC rules" data-testid="active-pmcc-rules" className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[10px] text-neutral-300">
      <h3 className="font-bold uppercase tracking-wider text-amber-300" data-testid="active-pmcc-rules-heading">{rules.heading}</h3>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {rules.items.map(item => (
          <li key={item.label} data-testid="active-pmcc-rule-item">
            <span className="text-neutral-400">{item.label}</span>{' '}
            <span className="font-normal text-neutral-200">{item.value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-neutral-400" data-testid="active-pmcc-rules-caption">{rules.caption}</p>
    </section>
  );
}
