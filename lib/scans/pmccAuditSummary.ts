import type { PmccFailureCode, PmccLegRejection } from './pmccTypes';

export interface PmccRejectionSummaryItem {
  code: PmccFailureCode;
  message: string;
  affectedLegs: number;
}

/**
 * Turns the chain-level audit trail into a concise explanation. A contract
 * can fail more than one rule, so this intentionally counts affected legs
 * per reason instead of implying that the buckets add up to the total.
 */
export function summarizePmccLegRejections(
  rejections: readonly PmccLegRejection[] | null | undefined,
): PmccRejectionSummaryItem[] {
  const counts = new Map<PmccFailureCode, PmccRejectionSummaryItem>();
  for (const rejection of rejections ?? []) {
    for (const failure of rejection.reasons) {
      const item = counts.get(failure.code);
      if (item) item.affectedLegs += 1;
      else counts.set(failure.code, { code: failure.code, message: failure.message, affectedLegs: 1 });
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.affectedLegs - a.affectedLegs || a.message.localeCompare(b.message));
}
