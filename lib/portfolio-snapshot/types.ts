// lib/portfolio-snapshot/types.ts
//
// LCC-0001A — canonical, account-scoped portfolio snapshot domain types.
// Implements docs/design/LCC-0001A-technical-spec.md §4, which itself implements master
// architecture §5.1 with field-level detail the master document intentionally left at summary
// level.
//
// This module introduces types only -- no acquisition, no normalization logic, no consumer
// wiring. See normalizeEquity.ts for the first normalizer that produces EquityHolding values.
//
// OptionPosition is deliberately NOT a new type here -- it is the existing, unmodified
// lib/portfolio-data/types.ts Position, referenced by import, per architecture decision AD-1
// (wrap the existing option-only adapter, do not replace it).

import type { Position } from '@/lib/portfolio-data/types';

export interface PortfolioSnapshot {
  accountNumber: string;
  asOf: string; // ISO snapshot-acquisition timestamp
  quoteAsOf: string | null; // may differ from asOf; null if unknown
  equities: EquityHolding[];
  options: Position[]; // existing type, unmodified
  workingOrders: WorkingOrder[];
  coverageEvidence: SnapshotCoverageEvidence;
  dataQuality: SnapshotDataQuality;
}

export interface SnapshotCoverageEvidence {
  existingShortCallsBySymbol: Record<string, number>;
  workingShortCallsBySymbol: Record<string, number>;
  unclassifiedSymbols: string[];
  complete: boolean;
  warnings: string[];
}

export type EquityDirection = 'Long' | 'Short';

export interface EquityHolding {
  accountNumber: string;
  symbol: string;
  // Retains short stock (unlike the pre-LCC-0001 normalizeEquityHoldings in
  // lib/scans/covered-call-capacity.ts, which filters to 'Long' only and silently drops short
  // rows). LCC-0001A's own acceptance criterion ("Short stock: the position remains visible but
  // contributes no covered-call capacity") requires short equities to be visible even though they
  // contribute zero capacity. This is a deliberate, spec-level extension of the ported logic, not
  // a behavior change to the ported capacity math -- capacity computation continues to treat
  // direction === 'Short' as zero contribution (master architecture invariant 2), it is only
  // visibility that is added here.
  direction: EquityDirection;
  quantity: number;
  // Not present in current broker payload usage; carried as null until a verified
  // settled-vs-total quantity field is confirmed present during a later implementation pass.
  // Never fabricated. See LCC-0001A technical spec §4/§13 open item.
  settledQuantity: number | null;
  // Ported from EquityHolding.costBasis (lib/scans/covered-call-capacity.ts). Null unless
  // basisComplete is true -- a partial-lot average is never presented as the whole-holding basis.
  basis: number | null;
  // Ported from EquityHolding.costBasisComplete. True only when every contributing lot for this
  // symbol+direction group had a valid, positive average-open-price.
  basisComplete: boolean;
  // Not populated by normalizeEquity.ts in this PR -- no quote source is wired in yet (PR 1 is
  // types + pure normalization only, no consumer wiring). Carried as null/false rather than
  // fabricated; a later PR wires the same quote-resolution path lib/portfolio-data/acquisition.ts
  // already uses for option positions.
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  quoteAsOf: string | null;
  staleQuote: boolean;
  // 'standard' unless adjusted-contract evidence exists on the raw position (mirrors
  // resolveOptionContractMultiplier's fallback-to-standard behavior, lib/scans/financials.ts).
  // Not derived from adjusted-contract evidence in this PR -- no such evidence is read from raw
  // positions yet; every holding normalizeEquity.ts produces here is 'standard'.
  deliverable: 'standard' | 'adjusted';
  dataQualityWarnings: string[];
}

export interface WorkingOrder {
  accountNumber: string;
  orderId: string | null;
  status: string; // raw broker status; case/whitespace-insensitive matching is a caller concern
  legs: WorkingOrderLeg[];
}

export interface WorkingOrderLeg {
  underlyingSymbol: string | null;
  symbol: string | null;
  action: string; // raw broker action string
  instrumentType: string | null;
  optionType: 'P' | 'C' | null;
  quantity: number;
}

export type CapacityDataStatus = 'ok' | 'unavailable';

export interface SnapshotDataQuality {
  status: CapacityDataStatus;
  unavailableReason?: string; // successor to UNATTRIBUTABLE_EXPOSURE_REASON
  staleQuotes: boolean;
  warnings: string[];
}
