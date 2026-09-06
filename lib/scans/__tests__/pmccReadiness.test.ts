import { describe, expect, it } from 'vitest';
import { evaluatePmccReadiness } from '../pmccReadiness';

const policy = { version: 'test-v1', earnings: 'warn' as const };
const pair: any = {
  qualified: true, failureReasons: [], primaryFailureReason: null,
  shortLeg: { expiration: '2099-02-20', quote: { readyInput: true } },
  longLeg: { quote: { readyInput: true } },
};

describe('evaluatePmccReadiness', () => {
  it('requires a qualified long and a current qualified pair', () => {
    expect(evaluatePmccReadiness({ pair, longContractQualified: true, earningsDate: null, policy }).status).toBe('PMCC_STRUCTURE_QUALIFIED');
  });
  it('fails closed on unavailable quotes', () => {
    expect(evaluatePmccReadiness({ pair: { ...pair, shortLeg: { ...pair.shortLeg, quote: { readyInput: false } } }, longContractQualified: true, earningsDate: null, policy }).status).toBe('WAIT_MONITOR');
  });
  it('does not qualify a structure when the long is unqualified', () => {
    expect(evaluatePmccReadiness({ pair, longContractQualified: false, earningsDate: null, policy }).status).toBe('NOT_QUALIFIED');
  });
  // Regression test: a structural failure must win over an unavailable
  // quote when both are present at once -- see the fix's own comment on
  // the final status computation for the full explanation. Before the
  // fix, this combined case incorrectly returned WAIT_MONITOR.
  it('classifies a structurally disqualified pair as NOT_QUALIFIED even when its quote is also unavailable', () => {
    const disqualifiedAndUnavailable = {
      ...pair,
      qualified: false,
      failureReasons: [{ code: 'INSUFFICIENT_DATA', message: 'Short quote is delayed' }],
      shortLeg: { ...pair.shortLeg, quote: { readyInput: false } },
    };
    expect(evaluatePmccReadiness({ pair: disqualifiedAndUnavailable, longContractQualified: true, earningsDate: null, policy }).status).toBe('NOT_QUALIFIED');
  });
});
