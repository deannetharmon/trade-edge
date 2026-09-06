import { describe, expect, it } from 'vitest';
import { evaluateLeapsEntry } from '../leapsEntryQualification';

const criteria = { deltaMin: 0.7, deltaMax: 0.85, dteMin: 180, oiMin: 100, extrinsicPctMax: 20, spreadPctMax: 10, policyVersion: 'test-v1' };
const candidate = { occSymbol: 'AAPL270618C00150000', strike: 150, dte: 285, delta: 0.8, openInterest: 500, bid: 58, ask: 60, underlyingPrice: 200 };

describe('evaluateLeapsEntry', () => {
  it('qualifies a complete candidate that passes every configured gate', () => {
    expect(evaluateLeapsEntry(candidate, criteria).status).toBe('CONTRACT_QUALIFIED');
  });

  it('fails closed when a required quote is unavailable', () => {
    expect(evaluateLeapsEntry({ ...candidate, ask: null }, criteria).status).toBe('DATA_UNAVAILABLE');
  });

  it('requires review when extrinsic policy is discovery mode', () => {
    expect(evaluateLeapsEntry(candidate, { ...criteria, extrinsicPctMax: null }).status).toBe('REVIEW_REQUIRED');
  });

  it('does not let a score-like liquid quote override a failed delta gate', () => {
    expect(evaluateLeapsEntry({ ...candidate, delta: 0.6 }, criteria).status).toBe('NOT_QUALIFIED');
  });
});
