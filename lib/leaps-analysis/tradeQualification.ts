import type { LeapsEntryQualification } from '@/lib/scans/leapsEntryQualification';

/** Presentation-only deterministic explanation. AI is intentionally absent. */
export function leapsReviewTradeDisabledReason(qualification: LeapsEntryQualification): string | null {
  if (qualification.status === 'CONTRACT_QUALIFIED') return null;
  const discovery = qualification.gates.find(gate => gate.id === 'extrinsicPct' && gate.status === 'not_applied');
  if (discovery) return 'Select an Extrinsic ceiling to complete contract qualification.';
  const blocker = qualification.gates.find(gate => gate.status === 'fail' || gate.status === 'unavailable');
  return blocker ? blocker.message : 'Contract qualification is unavailable.';
}
