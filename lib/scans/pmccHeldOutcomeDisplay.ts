// lib/scans/pmccHeldOutcomeDisplay.ts
//
// PMCC-HELD-BREAKEVEN-0001B-1 (Mock 3c): pure display selector for the three held-LEAP outcomes
// that PMCC-HELD-BREAKEVEN-0001 added (cost basis unavailable, multi-lot / unit-suspect, floor not
// met). Keyed on the engine reason code plus the pinned detail string. No React, no I/O, and no
// change to any qualification decision: this file only chooses words and ordering.
//
// Copy is the Ian-approved Mock 3c copy (docs/tickets/SCAN-ALIGN-0001-mock-3c.md). Do not reword
// without a new approval.

import { HELD_BREAKEVEN_DETAIL, readHeldBasis } from './pmccHeldBreakeven';
import type { PmccPairResult, PmccSessionResult } from './pmccTypes';
import type { PmccEarningsRemoval } from './pmccEarningsRemoval';

export type HeldOutcomeKind = 'results' | 'floor-not-met' | 'not-checked';

export interface HeldOutcomeInput {
  symbol: string;
  /** Engine reason code (COST_BASIS_UNAVAILABLE or SHORT_NOT_ABOVE_HELD_BREAKEVEN). */
  code: string;
  /** The engine's pinned detail string (HELD_BREAKEVEN_DETAIL) or floor message. */
  detail: string | null;
  /** Engine integer lot count (multi-lot banner). */
  quantity?: number | null;
  longStrike?: number | null;
  /** Per-share cost the floor used; absent on older restored sessions (fallback copy). */
  avgOpen?: number | null;
  /** False when a sibling short on the same LEAP did clear the floor: this pair alone is rejected,
   * and a "no short calls cleared the floor" banner would be false. Default true. */
  leapHasNoResults?: boolean;
}

export interface HeldOutcomeDisplay {
  kind: Exclude<HeldOutcomeKind, 'results'>;
  code: string;
  caption: string;
  /** Null when the card must not claim "no short calls cleared" (see leapHasNoResults). */
  banner: string | null;
  action: 'refresh-portfolio' | null;
  reasonLine: string;
  detailLine: string;
  /** Short calls were never checked (never render "no short calls found"). */
  notChecked: boolean;
  /** Basis null/zero/unparseable or held quantity invalid only. Unit-suspect and multi-lot are NOT. */
  isFixableReadFailure: boolean;
  /** Neutral grey Rejected tag, "Rejection reasons:" label, no near-miss styling. */
  rejected: boolean;
}

const money = (value: number): string => value.toFixed(2);
const strikeText = (value: number): string => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))));

/** Kl + cost in integer cents, like the engine's floor comparison. */
function floorOf(longStrike: number, avgOpen: number): number {
  return (Math.round(longStrike * 100) + Math.round(avgOpen * 100)) / 100;
}

const usable = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function selectHeldOutcome(input: HeldOutcomeInput): HeldOutcomeDisplay | null {
  const { symbol, code, detail } = input;

  if (code === 'SHORT_NOT_ABOVE_HELD_BREAKEVEN') {
    const reasonLine = `Reason: ${code}`;
    // Not every short reaches the floor check (shorts dropped earlier for delta, DTE or liquidity never do),
    // so the "every short that reached" wording is not used. With a passing sibling, only this short failed.
    const detailLine = input.leapHasNoResults === false ? 'Detail: this short did not clear the floor.' : 'Detail: no short cleared the floor.';
    const base = { kind: 'floor-not-met' as const, code, action: null, reasonLine, detailLine, notChecked: false, isFixableReadFailure: false, rejected: true };
    if (input.leapHasNoResults === false) return { ...base, caption: 'Floor not met', banner: null };
    if (usable(input.avgOpen) && typeof input.longStrike === 'number' && Number.isFinite(input.longStrike)) {
      const floor = money(floorOf(input.longStrike, input.avgOpen));
      return {
        ...base,
        caption: `Floor $${floor} (LEAP strike + cost)`,
        banner: `No short calls cleared the floor. A short must satisfy strike + bid > LEAP strike + your cost: ${strikeText(input.longStrike)} + ${money(input.avgOpen)} = $${floor}.`,
      };
    }
    // Fallback when the engine did not carry avgOpen (older restored session).
    return {
      ...base,
      caption: 'Floor not met',
      banner: 'No short calls cleared the floor. Floor not met (strike + bid at or below LEAP strike + your cost).',
    };
  }

  if (code === 'COST_BASIS_UNAVAILABLE') {
    const reasonLine = `Reason: ${code}`;
    if (detail === HELD_BREAKEVEN_DETAIL.multiLot) {
      const lots = typeof input.quantity === 'number' && Number.isInteger(input.quantity) && input.quantity > 1 ? `${input.quantity} contracts` : 'more than one contract';
      return {
        kind: 'not-checked', code, action: null, reasonLine, notChecked: true, isFixableReadFailure: false, rejected: true,
        caption: 'Multi-lot LEAP: cost unverified',
        banner: `Short calls were not checked. This LEAP has ${lots}, and cost averaging across lots is unverified.`,
        detailLine: 'Detail: multi-lot LEAP: cost averaging unverified.',
      };
    }
    if (detail === HELD_BREAKEVEN_DETAIL.unitSuspect) {
      return {
        kind: 'not-checked', code, action: 'refresh-portfolio', reasonLine, notChecked: true, isFixableReadFailure: false, rejected: true,
        caption: 'Cost basis unavailable',
        banner: `Short calls were not checked. Cost basis for ${symbol} looks wrong or could not be read from your broker.`,
        detailLine: 'Detail: cost basis unit suspect. Avg open price looks mis-scaled.',
      };
    }
    const fixable = detail === HELD_BREAKEVEN_DETAIL.basisUnavailable || detail === HELD_BREAKEVEN_DETAIL.quantityInvalid;
    const detailLine = detail === HELD_BREAKEVEN_DETAIL.quantityInvalid
      ? 'Detail: held quantity invalid.'
      : detail === HELD_BREAKEVEN_DETAIL.basisUnavailable || detail == null
        ? 'Detail: cost basis unavailable. Avg open price missing or unusable.'
        : `Detail: ${detail.replace(/\.+$/, '')}.`;
    return {
      kind: 'not-checked', code, action: 'refresh-portfolio', reasonLine, detailLine, notChecked: true, isFixableReadFailure: fixable, rejected: false,
      caption: 'Cost basis unavailable',
      banner: `Short calls were not checked. Cost basis for ${symbol} could not be read from your broker.`,
    };
  }

  return null;
}

/** Outcome for one pair, or null when it is not a held pair or carries no held-floor reason. */
export function heldOutcomeForPair(pair: PmccPairResult | null | undefined, symbol: string, leapHasNoResults = true): HeldOutcomeDisplay | null {
  if (!pair || pair.entryMode !== 'covered-short-call-against-held-leaps' || pair.qualified) return null;
  // The engine pushes at most one of the two codes, and cost-basis wins if both were ever present.
  const reason = pair.failureReasons.find(item => item.code === 'COST_BASIS_UNAVAILABLE')
    ?? pair.failureReasons.find(item => item.code === 'SHORT_NOT_ABOVE_HELD_BREAKEVEN');
  if (!reason) return null;
  return selectHeldOutcome({
    symbol, code: reason.code, detail: reason.message,
    quantity: pair.heldLongLeg?.quantity, longStrike: pair.longLeg.strike, avgOpen: pair.heldLongLeg?.avgOpenPrice ?? null,
    leapHasNoResults,
  });
}

// ---------------------------------------------------------------------------------------------
// SCAN-ALIGN-0001D: earnings-removed held outcome (a symbol-level outcome, no pair failure reason)
// ---------------------------------------------------------------------------------------------

/** Ian-approved copy (SCAN-ALIGN-0001D). No action button. Never "no short calls found". */
export function earningsRemovedBanner(earningsDate: string): string {
  return `Short calls not offered: earnings on ${earningsDate} falls on or before every expiry in your DTE range.`;
}

/**
 * Banner for a held symbol whose shorts were all removed by earnings, or null. COST_BASIS_UNAVAILABLE
 * (not-checked) wins: when the symbol also has a not-checked outcome, this returns null and the
 * not-checked banner is the one shown.
 */
export function selectEarningsRemovedBanner(removal: PmccEarningsRemoval | null | undefined, costBasisNotChecked = false): string | null {
  if (!removal || costBasisNotChecked) return null;
  if (!removal.heldMode || !removal.allShortsRemoved || removal.removedCount <= 0 || !removal.earningsDate) return null;
  return earningsRemovedBanner(removal.earningsDate);
}

// ---------------------------------------------------------------------------------------------
// SCAN-ALIGN-0001F (F2): delta-removed held outcome (a symbol-level outcome, no pair failure reason)
// ---------------------------------------------------------------------------------------------

/** Held-mode report of shorts the delta window removed. Set only when delta was the sole removal
 * reason for at least one short and no short survived pairing. Window is the scan's snapshot. */
export interface PmccDeltaRemoval {
  /** Snapshot criteria.shortDelta at scan time (never live control state). */
  min: number;
  max: number;
  /** Shorts that failed the window (with or without another reason). */
  removedCount: number;
  /** Shorts whose ONLY rejection reason was the delta window. */
  deltaOnlyCount: number;
  /** Eligible shorts plus short rejections. */
  consideredCount: number;
}

/**
 * Builds the delta-removal report from a pairing session, or undefined. Not shown for new-entry
 * scans, when any short survived pairing, or when delta was never the sole reason for a removal
 * (an empty chain, or one emptied by OI / quote / DTE, does not blame delta).
 */
export function computePmccDeltaRemoval(session: PmccSessionResult, heldMode: boolean): PmccDeltaRemoval | undefined {
  if (!heldMode || session.counts.eligibleShortLegs > 0) return undefined;
  const shorts = session.legRejections.filter(item => item.role === 'short');
  const withDelta = shorts.filter(item => item.reasons.some(reason => reason.code === 'DELTA_OUT_OF_RANGE'));
  const deltaOnly = withDelta.filter(item => item.reasons.every(reason => reason.code === 'DELTA_OUT_OF_RANGE'));
  if (deltaOnly.length === 0) return undefined;
  return {
    min: session.criteria.shortDelta.min, max: session.criteria.shortDelta.max,
    removedCount: withDelta.length, deltaOnlyCount: deltaOnly.length,
    consideredCount: session.counts.eligibleShortLegs + shorts.length,
  };
}

export function deltaRemovedBanner(min: number, max: number): string {
  return `No short calls within your delta window (${min.toFixed(2)} to ${max.toFixed(2)}). Adjust Min/Max delta.`;
}

export interface DeltaRemovedNotice { banner: string; reasonLine: string }

/**
 * Notice for a held symbol whose shorts were all removed by the delta window, or null. Precedence:
 * cost-basis not-checked, then earnings-removed, then delta. No action button; never "no short calls found".
 */
export function selectDeltaRemovedNotice(
  removal: PmccDeltaRemoval | null | undefined,
  costBasisNotChecked = false,
  earningsRemoved = false,
): DeltaRemovedNotice | null {
  if (!removal || costBasisNotChecked || earningsRemoved) return null;
  if (removal.deltaOnlyCount <= 0 || removal.removedCount <= 0 || !Number.isFinite(removal.min) || !Number.isFinite(removal.max)) return null;
  return {
    banner: deltaRemovedBanner(removal.min, removal.max),
    reasonLine: `${removal.removedCount} short${removal.removedCount === 1 ? '' : 's'} fell outside the window`,
  };
}

export const HELD_OUTCOME_RANK: Record<HeldOutcomeKind, number> = { results: 0, 'floor-not-met': 1, 'not-checked': 2 };

// ---------------------------------------------------------------------------------------------
// Per-LEAP state, per-symbol header, card ordering
// ---------------------------------------------------------------------------------------------

export interface HeldDisplayPlan {
  /** LEAP state per candidateId (results without a held floor reason are absent = 'results'). */
  rankById: ReadonlyMap<string, number>;
  /** Extra cards of a LEAP that has no results: one card per LEAP carries the statement. */
  hiddenIds: ReadonlySet<string>;
  /** candidateIds of pairs whose LEAP has at least one short that did not fail the floor. */
  leapHasResultsIds: ReadonlySet<string>;
  /** One-line ambient row per symbol, only for symbols with 2+ held LEAPs. */
  summaryBySymbol: ReadonlyMap<string, string>;
}

interface ResultLike { symbol: string; candidateId?: string; pmccPair?: PmccPairResult }

const HELD_MODE = 'covered-short-call-against-held-leaps';

export function formatHeldLeapSummary(symbol: string, counts: { leaps: number; results: number; floor: number; notChecked: number }): string {
  const parts = [`${symbol}`, `${counts.leaps} held LEAPs`];
  if (counts.results > 0) parts.push(`${counts.results} with results`);
  if (counts.floor > 0) parts.push(`${counts.floor} no shorts cleared`);
  if (counts.notChecked > 0) parts.push(`${counts.notChecked} not checked`);
  return parts.join(' · ');
}

/**
 * Plans the held-LEAP display over the FULL (unfiltered) PMCC result list of a session.
 * LEAP state: not-checked when its pairs carry COST_BASIS_UNAVAILABLE; floor-not-met when every
 * retained pair fails the floor; otherwise results (a short cleared the floor; it may still be a
 * near-miss on other criteria). Order is by state (results, floor-not-met, not-checked), stable
 * within a state, so a rejected LEAP never sorts above a valid result and Refresh Portfolio cannot
 * reshuffle cards. Counts sum to the LEAP count.
 */
export function planHeldPmccDisplay(results: readonly ResultLike[]): HeldDisplayPlan {
  type Leap = { symbol: string; ids: string[]; anyCostBasis: boolean; allFloor: boolean };
  const leaps = new Map<string, Leap>();
  for (const result of results) {
    const pair = result.pmccPair;
    if (!pair || pair.entryMode !== HELD_MODE || result.candidateId == null) continue;
    const key = `${result.symbol}::${pair.longLeg.occSymbol}`;
    const leap = leaps.get(key) ?? { symbol: result.symbol, ids: [], anyCostBasis: false, allFloor: true };
    leap.ids.push(result.candidateId);
    if (pair.failureReasons.some(item => item.code === 'COST_BASIS_UNAVAILABLE')) leap.anyCostBasis = true;
    if (pair.qualified || !pair.failureReasons.some(item => item.code === 'SHORT_NOT_ABOVE_HELD_BREAKEVEN')) leap.allFloor = false;
    leaps.set(key, leap);
  }

  const rankById = new Map<string, number>();
  const hiddenIds = new Set<string>();
  const leapHasResultsIds = new Set<string>();
  const perSymbol = new Map<string, { leaps: number; results: number; floor: number; notChecked: number }>();
  leaps.forEach(leap => {
    const kind: HeldOutcomeKind = leap.anyCostBasis ? 'not-checked' : leap.allFloor ? 'floor-not-met' : 'results';
    const counts = perSymbol.get(leap.symbol) ?? { leaps: 0, results: 0, floor: 0, notChecked: 0 };
    counts.leaps += 1;
    if (kind === 'results') counts.results += 1;
    else if (kind === 'floor-not-met') counts.floor += 1;
    else counts.notChecked += 1;
    perSymbol.set(leap.symbol, counts);
    leap.ids.forEach((id, index) => {
      rankById.set(id, HELD_OUTCOME_RANK[kind]);
      if (kind === 'results') leapHasResultsIds.add(id);
      else if (index > 0) hiddenIds.add(id);
    });
  });

  const summaryBySymbol = new Map<string, string>();
  perSymbol.forEach((counts, symbol) => {
  if (counts.leaps >= 2) {
    summaryBySymbol.set(symbol, formatHeldLeapSummary(symbol, counts));
  }
});
  return { rankById, hiddenIds, leapHasResultsIds, summaryBySymbol };
}

/** Removes hidden duplicate cards and stable-sorts by LEAP state. Non-held cards keep rank 0. */
export function orderHeldGroup<T extends { candidateId?: string }>(group: readonly T[], plan: HeldDisplayPlan): T[] {
  return group
    .filter(item => item.candidateId == null || !plan.hiddenIds.has(item.candidateId))
    .map((item, index) => ({ item, index, rank: item.candidateId == null ? 0 : plan.rankById.get(item.candidateId) ?? 0 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(entry => entry.item);
}

// ---------------------------------------------------------------------------------------------
// Discovery-time pre-modal block
// ---------------------------------------------------------------------------------------------

export interface HeldReadCandidate { underlyingSymbol: string; avgOpenPrice: unknown; quantity: unknown }

/** Mirrors the engine's check order: basis first, then quantity. Only these two are fixable by a
 * portfolio refresh. Multi-lot (quantity > 1) and unit-suspect (needs spot) are NOT classified here. */
export function classifyHeldReadFailure(candidate: HeldReadCandidate): 'basis' | 'quantity' | null {
  if (readHeldBasis(candidate.avgOpenPrice) === null) return 'basis';
  const q = candidate.quantity;
  const valid = typeof q === 'number' && Number.isInteger(q) && q >= 1;
  return valid ? null : 'quantity';
}

export interface PreModalReadFailure {
  message: string;
  /** Collapsed details line, only when a held quantity was invalid. */
  details: string | null;
}

const MAX_SYMBOLS_LISTED = 3;

/** Non-null only when EVERY selected held LEAP has a fixable read failure. */
export function buildPreModalReadFailure(candidates: readonly HeldReadCandidate[]): PreModalReadFailure | null {
  if (candidates.length === 0) return null;
  const kinds = candidates.map(classifyHeldReadFailure);
  if (kinds.some(kind => kind === null)) return null;
  const symbols = Array.from(new Set(candidates.map(candidate => candidate.underlyingSymbol)));
  const details = kinds.includes('quantity') ? 'Details: COST_BASIS_UNAVAILABLE, held quantity invalid' : null;
  if (candidates.length === 1) {
    return { message: `Could not read cost basis. Cost basis for ${symbols[0]} could not be read from your broker. Refresh Portfolio and try again.`, details };
  }
  const listed = symbols.slice(0, MAX_SYMBOLS_LISTED).join(', ');
  const more = symbols.length > MAX_SYMBOLS_LISTED ? ` +${symbols.length - MAX_SYMBOLS_LISTED} more` : '';
  return {
    message: `Could not read cost basis. Cost basis for ${candidates.length} held LEAPs could not be read from your broker: ${listed}${more}. Refresh Portfolio and try again.`,
    details,
  };
}
