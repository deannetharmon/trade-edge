// features/screener/components/RsiEntryChip.tsx

// RSI-ENTRY-0001 slice A2a: the entry timing chip on a CSP or CC result row (Diane's approved mock).
// Pass is a quiet green, Wait a neutral grey, "RSI n/a" faint. Wait is deliberately not red or amber: it is a timing
// hint on Best Opportunity eligibility, not a failed rule, so it must not read like a qualification warning.
// The words carry the meaning; the colour only reinforces it.

import type { RsiEntryGateResult } from '@/lib/indicators/rsiEntryGate';

const CLASS: Record<RsiEntryGateResult['verdict'], string> = {
  PASS: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300',
  WAIT: 'border-neutral-600 bg-neutral-800/60 text-neutral-300',
  UNAVAILABLE: 'border-neutral-700 bg-transparent text-neutral-500',
};

const TITLE: Record<RsiEntryGateResult['verdict'], string> = {
  PASS: 'Entry timing (daily RSI): turned off its extreme. Eligible for Best Opportunities.',
  WAIT: 'Entry timing (daily RSI): not yet turned. Still tradeable; not eligible for Best Opportunities while the gate is On.',
  UNAVAILABLE: 'Entry timing (daily RSI): not enough price history. Counts as Wait while the gate is On.',
};

export function RsiEntryChip({ entry }: { entry: RsiEntryGateResult }) {
  return (
    <span
      data-testid="rsi-entry-chip"
      data-verdict={entry.verdict}
      title={TITLE[entry.verdict]}
      className={`inline-block max-w-full rounded border px-2 py-0.5 text-[9px] font-bold ${CLASS[entry.verdict]}`}
    >
      {entry.label}
    </span>
  );
}
