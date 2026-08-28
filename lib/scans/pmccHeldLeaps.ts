import type { Position } from '@/lib/portfolio-data/types';
import type { PortfolioSnapshot } from '@/lib/portfolio-snapshot/types';
import type { PmccDteRanges } from './pmccDteRanges';
import type { PmccChainLeg } from './pmccTypes';

/** A broker-owned long call that may supply the long leg of a PMCC review.
 * This is deliberately position identity, not merely a ticker/strike hint. */
export interface HeldPmccLongCandidate {
  accountNumber: string;
  positionKey: string;
  underlyingSymbol: string;
  occSymbol: string;
  expiration: string;
  dte: number;
  strike: number;
  quantity: number;
}

export interface HeldPmccExclusion {
  positionKey: string;
  symbol: string;
  reason: string;
}

export interface HeldPmccSelection {
  candidates: HeldPmccLongCandidate[];
  exclusions: HeldPmccExclusion[];
}

function exactOneLongCall(position: Position): HeldPmccLongCandidate | null {
  // Discovery is review-only: a close-order identity is not relevant to
  // whether the broker reports one exact long call. Structural ambiguity is
  // still a hard exclusion, and execution remains unavailable on this path.
  if (position.structureAmbiguous) return null;
  if (position.legs.length !== 1) return null;
  const leg = position.legs[0];
  if (leg.direction !== 'Long' || leg.optionType !== 'C' || !Number.isFinite(leg.strikePrice) || leg.quantity <= 0) return null;
  const occSymbol = leg.symbol?.trim();
  const underlyingSymbol = position.symbol?.trim().toUpperCase();
  if (!occSymbol || !underlyingSymbol || !/^\d{4}-\d{2}-\d{2}$/.test(position.expDate)) return null;
  return {
    accountNumber: position.accountNumber,
    positionKey: position.key,
    underlyingSymbol,
    occSymbol,
    expiration: position.expDate,
    dte: position.dte,
    strike: leg.strikePrice,
    quantity: leg.quantity,
  };
}

/** Fail closed: only a current, attributable portfolio snapshot may produce
 * held-long PMCC candidates. DTE still follows the submitted PMCC policy. */
export function selectHeldPmccLongCandidates(
  snapshot: PortfolioSnapshot | null,
  dte: PmccDteRanges,
): HeldPmccSelection {
  if (snapshot == null) return { candidates: [], exclusions: [] };
  if (snapshot.freshness !== 'current' || snapshot.dataQuality.status !== 'ok') {
    return {
      candidates: [],
      exclusions: snapshot.options.map(position => ({
        positionKey: position.key, symbol: position.symbol,
        reason: 'Portfolio snapshot is not current and attributable',
      })),
    };
  }
  const candidates: HeldPmccLongCandidate[] = [];
  const exclusions: HeldPmccExclusion[] = [];
  for (const position of snapshot.options) {
    const candidate = exactOneLongCall(position);
    if (candidate == null || candidate.accountNumber !== snapshot.accountNumber) {
      exclusions.push({ positionKey: position.key, symbol: position.symbol, reason: 'Not an unambiguous single-leg long call in the active account' });
      continue;
    }
    if (position.dte < dte.longMin || position.dte > dte.longMax) {
      exclusions.push({ positionKey: position.key, symbol: position.symbol, reason: 'Held long call is outside the configured PMCC long DTE range' });
      continue;
    }
    candidates.push(candidate);
  }
  return { candidates, exclusions };
}

/**
 * Select broker positions supplied by the shared PortfolioDataProvider when
 * the optional snapshot rollout is disabled. The provider's legacy position
 * acquisition is already scoped to the active account, but we still require
 * a single reported account rather than guessing across accounts.
 */
export function selectHeldPmccLongCandidatesFromPositions(
  positions: readonly Position[],
  dte: PmccDteRanges,
): HeldPmccSelection {
  const accounts = new Set(positions.map(position => position.accountNumber?.trim()).filter(Boolean));
  if (accounts.size !== 1) {
    return {
      candidates: [],
      exclusions: positions.map(position => ({
        positionKey: position.key,
        symbol: position.symbol,
        reason: 'Portfolio positions do not resolve to one active account',
      })),
    };
  }
  const accountNumber = Array.from(accounts)[0];
  const candidates: HeldPmccLongCandidate[] = [];
  const exclusions: HeldPmccExclusion[] = [];
  for (const position of positions) {
    const candidate = exactOneLongCall(position);
    if (candidate == null || candidate.accountNumber !== accountNumber) {
      exclusions.push({ positionKey: position.key, symbol: position.symbol, reason: 'Not an unambiguous single-leg long call in the active account' });
      continue;
    }
    if (position.dte < dte.longMin || position.dte > dte.longMax) {
      exclusions.push({ positionKey: position.key, symbol: position.symbol, reason: 'Held long call is outside the configured PMCC long DTE range' });
      continue;
    }
    candidates.push(candidate);
  }
  return { candidates, exclusions };
}

/** Match every field available from the broker position. A same-symbol or
 * same-strike contract is never an acceptable substitute. */
export function matchHeldPmccLongCandidate(
  candidate: HeldPmccLongCandidate,
  liveLongLegs: readonly PmccChainLeg[],
): PmccChainLeg | null {
  return liveLongLegs.find(leg =>
    leg.occSymbol === candidate.occSymbol
    && leg.underlyingSymbol === candidate.underlyingSymbol
    && leg.optionType === 'C'
    && leg.expiration === candidate.expiration
    && leg.strike === candidate.strike,
  ) ?? null;
}
