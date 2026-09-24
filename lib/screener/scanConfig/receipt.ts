// lib/screener/scanConfig/receipt.ts
//
// SCREENER-CONFIG-0001B -- the strategy-neutral receipt builder. A strategy registry
// supplies its criteria (each with a summary line, a summary group, and whether changing it
// needs a rescan); this turns them into the grouped rows the scan summary and the result
// receipt both show, so the two cannot disagree.

import { SUMMARY_GROUP_LABEL, type ReceiptGroup, type SummaryGroup } from './types';

export interface ReceiptCriterion<V> {
  summaryGroup: SummaryGroup;
  rescan: boolean;
  summary: (values: V) => string | null;
}

/**
 * Builds the grouped receipt rows for the criteria that apply. A criterion whose summary is
 * null (an off state, another mode) is left out, and an empty group is left out.
 */
export function buildReceiptGroups<V>(
  criteria: readonly ReceiptCriterion<V>[],
  values: V,
  groupOrder: readonly SummaryGroup[],
): ReceiptGroup[] {
  const byGroup = new Map<SummaryGroup, { items: string[]; rescan: boolean }>();
  for (const criterion of criteria) {
    const text = criterion.summary(values);
    if (text == null) continue;
    const entry = byGroup.get(criterion.summaryGroup) ?? { items: [], rescan: false };
    entry.items.push(text);
    entry.rescan = entry.rescan || criterion.rescan;
    byGroup.set(criterion.summaryGroup, entry);
  }
  return groupOrder.flatMap((key) => {
    const entry = byGroup.get(key);
    if (!entry) return [];
    const label = key === 'search' ? `${SUMMARY_GROUP_LABEL[key]} · rescan to change` : SUMMARY_GROUP_LABEL[key];
    return [{ key, label, rescan: entry.rescan, items: entry.items }];
  });
}
