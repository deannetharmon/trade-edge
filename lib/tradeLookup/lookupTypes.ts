// lib/tradeLookup/lookupTypes.ts

// TRADE-LOOKUP-0001B: shapes for the chain rows the lookup reads and the result it hands the UI.
// Pure data. No React, no network.

import type { ExpiryResolution, IsoDate, OptionRight, ParsedContract } from './types';
import type { LookupSignals } from './signals';

/** One option contract from the broker chain, already normalized. Missing values are null, never 0. */
export interface ChainRow {
  strike: number;
  right: OptionRight;
  expiration: IsoDate;
  bid: number | null;
  ask: number | null;
  /** Broker delta as given (puts are negative). */
  delta: number | null;
  openInterest: number | null;
  /** Implied volatility in percent (63 means 63%). */
  iv: number | null;
  occSymbol: string;
  quoteUpdatedAt: string | null;
}

export type Classification = 'index' | 'etf' | 'stock';

export type FlagCode = 'delta_outside_band' | 'wide_spread' | 'thin_oi' | 'below_cost_basis';

/** Advisory only. A flag never blocks a row, disables Select, or feeds a score. */
export interface RowFlag {
  code: FlagCode;
  label: string;
}

export interface LookupRow {
  strike: number;
  right: OptionRight;
  expiration: IsoDate;
  dte: number;
  /** The contract the group posted. */
  isPick: boolean;
  /** Same strike on the next expiration out. */
  isNextExpiration: boolean;
  /** No usable bid/ask. Everything priced from the quote is null; never filled from a last price. */
  noQuote: boolean;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  /** The credit if sold at the bid. */
  natural: number | null;
  /** Broker delta as given (puts are negative). */
  delta: number | null;
  /** Percent, from positionMetrics.calcPositionPop. Null when price, IV or the quote is missing. */
  pop: number | null;
  /** Credit per share at mid. */
  credit: number | null;
  breakeven: number | null;
  /** Dollars for the whole order. CSP only (strike minus credit, times 100, times contracts). */
  maxRisk: number | null;
  openInterest: number | null;
  spreadPct: number | null;
  /** Row credit minus the pick's credit. Null on the pick itself or when either side has no quote. */
  creditVsPick: number | null;
  /** Row POP minus the pick's POP, in percentage points. */
  popVsPick: number | null;
  occSymbol: string;
  flags: RowFlag[];
}

export type CoverageStatus = 'not_applicable' | 'covered_by_shares' | 'covered_by_leap' | 'not_covered' | 'unknown';

export interface CoverageResult {
  status: CoverageStatus;
  contractsNeeded: number;
  /** True only when the order dialog may be opened for this contract. */
  canOrder: boolean;
  message: string;
}

export interface PostedComparison {
  postedPrice: number | null;
  mid: number | null;
  /** Mid minus posted. Negative means less credit now than the group quoted. */
  change: number | null;
  changePct: number | null;
  postAgeDays: number | null;
}

export type LookupStatus = 'ok' | 'strike_not_listed' | 'no_rows';

export interface LookupResult {
  status: LookupStatus;
  contract: ParsedContract;
  expiration: IsoDate;
  contracts: number;
  /** Strikes (and the next expiration) in display order. The pick is in here with isPick true. */
  rows: LookupRow[];
  pick: LookupRow | null;
  /** When the strike is not listed: the closest listed strikes below and above. */
  nearestStrikes: number[];
  underlyingPrice: number | null;
  classification: Classification | null;
  posted: PostedComparison;
  coverage: CoverageResult;
  /** Most recent broker quote time among the pick expiration's rows. */
  quotesAsOf: string | null;
  /** RSI and earnings, information only. Absent when the loader had no way to read them. */
  signals?: LookupSignals;
  notes: string[];
}

export type LoadOutcome =
  | { kind: 'result'; result: LookupResult; resolution: ExpiryResolution }
  /** The date cannot be used (expired, not listed, impossible) or needs the user to confirm it first. */
  | { kind: 'blocked'; resolution: ExpiryResolution }
  | { kind: 'error'; message: string };
