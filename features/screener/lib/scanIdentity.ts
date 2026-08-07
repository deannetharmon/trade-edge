// features/screener/lib/scanIdentity.ts
//
// SCREENER-UX-0001 — pure title derivation for the results workspace's "scan
// identity" heading. Deliberately reads ONLY the canonical session's own
// `mode`/`requestedStrategy` fields (Task 1's authoritative record of what
// was actually requested) — never inferred from visible cards, prior UI
// state, or candidate shape, per the ticket's explicit requirement.

import type { ScreenerRequestedStrategy, ScreenerScanMode } from '@/lib/screener/scanSession';

export interface ScanIdentity {
  title: string;
  modeLabel: string;
  requestedStrategyLabel: string;
}

const MODE_LABELS: Record<ScreenerScanMode, string> = {
  filter: 'Filtered',
  rank: 'Ranked',
  targeted: 'Targeted',
};

const STRATEGY_LABELS: Record<ScreenerRequestedStrategy, string> = {
  spreads: 'Spread',
  csp: 'Cash-Secured Put',
  cc: 'Covered Call',
  pmcc: 'PMCC',
};

// The six exact titles required by SCREENER-UX-0001. csp/cc/pmcc are
// Filtered-only in the canonical model (STRATEGY_ALLOWED_MODES in
// scanSession.ts), so there are exactly six real (mode, requestedStrategy)
// combinations in production — this table is exhaustive for all of them.
function buildTitle(mode: ScreenerScanMode, requestedStrategy: ScreenerRequestedStrategy): string {
  if (requestedStrategy === 'spreads') {
    if (mode === 'filter') return 'Filtered Spread Scan';
    if (mode === 'rank') return 'Ranked Spread Scan';
    return 'Targeted Spread Scan';
  }
  if (requestedStrategy === 'csp') return 'Cash-Secured Put Scan';
  if (requestedStrategy === 'cc') return 'Covered Call Scan';
  return 'PMCC Scan';
}

export function getScanIdentity(
  mode: ScreenerScanMode,
  requestedStrategy: ScreenerRequestedStrategy,
): ScanIdentity {
  return {
    title: buildTitle(mode, requestedStrategy),
    modeLabel: MODE_LABELS[mode],
    requestedStrategyLabel: STRATEGY_LABELS[requestedStrategy],
  };
}
