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
  if (position.structureAmbiguous || position.identity == null) return null;
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
