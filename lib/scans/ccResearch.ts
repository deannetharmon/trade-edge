// lib/scans/ccResearch.ts
// CC-RESEARCH-0001 -- covered-call "research" scans: any ticker, scanned as if 100 shares (or the shares you hold) were owned.
//
// Research results are for comparison only. They carry no coverage proof, so they can never become an order:
// the capacity built here is hypothetical and is labeled so. Entry price, in order of precedence:
//   1. a price typed for this scan,
//   2. your own position's cost basis (the typed basis first, then the broker's),
//   3. the current stock price, as if bought today (labeled "assumed").

import { computeCoveredCallCapacity, type CoveredCallCapacity } from './covered-call-capacity';

export type CcResearchEntrySource = 'typed-for-scan' | 'position-typed' | 'position-broker' | 'price-assumed';

export interface CcResearchEntry {
  entry: number | null;
  source: CcResearchEntrySource | null;
}

function positive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

export function resolveResearchEntry(input: {
  typedForScan?: number | null;
  /** The user's own position basis for this symbol, when they hold it and it is known. */
  position?: { basis: number | null; source: 'typed' | 'broker' | null } | null;
  stockPrice: number | null | undefined;
}): CcResearchEntry {
  if (positive(input.typedForScan)) return { entry: input.typedForScan, source: 'typed-for-scan' };
  const p = input.position;
  if (p && positive(p.basis) && p.source) return { entry: p.basis, source: p.source === 'typed' ? 'position-typed' : 'position-broker' };
  if (positive(input.stockPrice)) return { entry: input.stockPrice, source: 'price-assumed' };
  return { entry: null, source: null };
}

/**
 * Hypothetical capacity for a research scan: the shares you hold (rounded down to whole contracts, at least one
 * contract), no existing or working calls counted. Never used for an order.
 */
export function buildResearchCapacity(sharesHeld: number | null | undefined, entry: number | null): CoveredCallCapacity {
  const contracts = Math.max(1, Math.floor(Math.max(0, Number.isFinite(sharesHeld ?? NaN) ? (sharesHeld as number) : 0) / 100));
  return computeCoveredCallCapacity(contracts * 100, 0, 0, entry, entry !== null);
}

const SOURCE_LABELS: Record<CcResearchEntrySource, string> = {
  'typed-for-scan': 'entry price typed for this scan',
  'position-typed': 'your position (typed basis)',
  'position-broker': 'your position (broker basis)',
  'price-assumed': 'current price (assumed, no real cost basis)',
};

export function researchEntryLabel(source: CcResearchEntrySource | null): string {
  return source ? SOURCE_LABELS[source] : 'no entry price available';
}
