import { describe, expect, it } from 'vitest';
import { matchHeldPmccLongCandidate, selectHeldPmccLongCandidates, selectHeldPmccLongCandidatesFromPositions } from '../pmccHeldLeaps';
import { buildNewPmccEntryOrderLegs } from '../pmccOrderIntent';
import type { Position } from '@/lib/portfolio-data/types';
import type { PortfolioSnapshot } from '@/lib/portfolio-snapshot/types';
import type { PmccChainLeg } from '../pmccTypes';

const heldPosition = (overrides: Partial<Position> = {}): Position => ({
  key: 'position-1', symbol: 'MRNA', expDate: '2027-06-18', dte: 295,
  accountNumber: '5WT00001', structureAmbiguous: false, identity: {} as Position['identity'],
  legs: [{ symbol: 'MRNA  270618C00110000', optionType: 'C', strikePrice: 110, direction: 'Long', quantity: 2, avgOpenPrice: 12, currentPrice: 15 }],
  ...overrides,
} as Position);

const snapshot = (options: Position[], overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot => ({
  accountNumber: '5WT00001', asOf: '2026-08-27T15:00:00.000Z', quoteAsOf: '2026-08-27T15:00:00.000Z',
  equities: [], options, workingOrders: [], freshness: 'current', lastSuccessfulAsOf: '2026-08-27T15:00:00.000Z',
  coverageEvidence: { existingShortCallsBySymbol: {}, workingShortCallsBySymbol: {}, unclassifiedSymbols: [], complete: true, warnings: [], hasAdjustedOrUnknownDeliverable: false },
  dataQuality: { status: 'ok', staleQuotes: false, warnings: [] }, ...overrides,
});

const chainLeg = (overrides: Partial<PmccChainLeg> = {}): PmccChainLeg => ({
  underlyingSymbol: 'MRNA', optionType: 'C', expiration: '2027-06-18', strike: 110,
  delta: 0.8, openInterest: 2, bid: 12, ask: 13, occSymbol: 'MRNA  270618C00110000',
  quoteTimestamp: '2026-08-27T15:00:00.000Z', delayed: false, ...overrides,
});

describe('held LEAPS PMCC candidates', () => {
  const dte = { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 };

  it('selects only a current, active-account, unambiguous single long call', () => {
    const result = selectHeldPmccLongCandidates(snapshot([
      heldPosition(),
      heldPosition({ key: 'ambiguous', structureAmbiguous: true }),
      heldPosition({ key: 'spread', legs: [heldPosition().legs[0], { ...heldPosition().legs[0], direction: 'Short', strikePrice: 160 }] }),
      heldPosition({ key: 'wrong-account', accountNumber: '5WT99999' }),
    ]), dte);
    expect(result.candidates).toEqual([expect.objectContaining({ positionKey: 'position-1', occSymbol: 'MRNA  270618C00110000', quantity: 2 })]);
    expect(result.exclusions).toHaveLength(3);
  });

  it('fails closed for stale or unavailable snapshots', () => {
    expect(selectHeldPmccLongCandidates(snapshot([heldPosition()], { freshness: 'last-known' }), dte).candidates).toEqual([]);
    expect(selectHeldPmccLongCandidates(snapshot([heldPosition()], { dataQuality: { status: 'unavailable', staleQuotes: true, warnings: [] } }), dte).candidates).toEqual([]);
  });

  it('uses current provider positions when the optional snapshot rollout is disabled', () => {
    const result = selectHeldPmccLongCandidatesFromPositions([heldPosition()], dte);
    expect(result.candidates).toEqual([expect.objectContaining({ positionKey: 'position-1', dte: 295 })]);
  });

  it('does not guess which account to use when provider positions span accounts', () => {
    const result = selectHeldPmccLongCandidatesFromPositions([
      heldPosition(),
      heldPosition({ key: 'other-account', accountNumber: '5WT99999' }),
    ], dte);
    expect(result.candidates).toEqual([]);
    expect(result.exclusions).toHaveLength(2);
  });

  it('requires exact OCC, underlying, call type, expiry, and strike identity', () => {
    const candidate = selectHeldPmccLongCandidates(snapshot([heldPosition()]), dte).candidates[0];
    expect(matchHeldPmccLongCandidate(candidate, [chainLeg()])).toEqual(chainLeg());
    expect(matchHeldPmccLongCandidate(candidate, [chainLeg({ occSymbol: 'MRNA  270618C00115000', strike: 115 })])).toBeNull();
    expect(matchHeldPmccLongCandidate(candidate, [chainLeg({ occSymbol: candidate.occSymbol, expiration: '2027-07-16' })])).toBeNull();
  });

  it('cannot turn a held LEAPS candidate into a two-leg new-PMCC ticket', () => {
    const pair = {
      entryMode: 'covered-short-call-against-held-leaps' as const,
      longLeg: { occSymbol: 'MRNA  270618C00110000' }, shortLeg: { occSymbol: 'MRNA  260918C00180000' },
    };
    expect(() => buildNewPmccEntryOrderLegs(pair as any)).toThrow('review-only');
  });
});
