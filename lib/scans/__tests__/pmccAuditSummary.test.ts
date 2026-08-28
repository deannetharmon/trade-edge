import { describe, expect, it } from 'vitest';
import { summarizePmccLegRejections } from '../pmccAuditSummary';

describe('summarizePmccLegRejections', () => {
  it('counts reason occurrences without treating overlapping failures as exclusive buckets', () => {
    const result = summarizePmccLegRejections([
      { role: 'short', expiration: '2026-09-18', strike: 75, occSymbol: 'ACME260918C00075000', reasons: [
        { code: 'SHORT_NOT_OTM', message: 'Short call is not out of the money' },
        { code: 'OPEN_INTEREST_BELOW_MINIMUM', message: 'Open interest is below the submitted minimum' },
      ] },
      { role: 'short', expiration: '2026-09-18', strike: 80, occSymbol: 'ACME260918C00080000', reasons: [
        { code: 'SHORT_NOT_OTM', message: 'Short call is not out of the money' },
      ] },
    ]);

    expect(result).toEqual([
      { code: 'SHORT_NOT_OTM', message: 'Short call is not out of the money', affectedLegs: 2 },
      { code: 'OPEN_INTEREST_BELOW_MINIMUM', message: 'Open interest is below the submitted minimum', affectedLegs: 1 },
    ]);
  });

  it('groups wording variants for the same stable failure code', () => {
    const result = summarizePmccLegRejections([
      { role: 'short', expiration: '2026-09-18', strike: 80, occSymbol: 'ACME260918C00080000', reasons: [
        { code: 'INSUFFICIENT_DATA', message: 'Quote timestamp is unavailable' },
      ] },
      { role: 'short', expiration: '2026-10-16', strike: 85, occSymbol: 'ACME261016C00085000', reasons: [
        { code: 'INSUFFICIENT_DATA', message: 'Delta is missing or invalid' },
      ] },
    ]);

    expect(result).toEqual([{ code: 'INSUFFICIENT_DATA', message: 'Required contract data is missing or invalid', affectedLegs: 2 }]);
  });

  it('uses a category label rather than a single contract spread percentage', () => {
    const result = summarizePmccLegRejections([
      { role: 'short', expiration: '2026-09-18', strike: 80, occSymbol: 'ACME260918C00080000', reasons: [
        { code: 'BID_ASK_TOO_WIDE', message: 'Bid/ask spread 10.75% exceeds 10%' },
      ] },
      { role: 'short', expiration: '2026-10-16', strike: 85, occSymbol: 'ACME261016C00085000', reasons: [
        { code: 'BID_ASK_TOO_WIDE', message: 'Bid/ask spread 28.75% exceeds 10%' },
      ] },
    ]);
    expect(result).toEqual([{ code: 'BID_ASK_TOO_WIDE', message: 'Bid/ask spread exceeds the qualifying maximum', affectedLegs: 2 }]);
  });

  it('handles an empty audit trail', () => {
    expect(summarizePmccLegRejections([])).toEqual([]);
  });

  it('counts every supplied exclusion, including audits larger than 100 contracts', () => {
    const rejections = Array.from({ length: 125 }, (_, strike) => ({
      role: 'short' as const, expiration: '2026-09-18', strike,
      occSymbol: `ACME260918C${String(strike * 1000).padStart(8, '0')}`,
      reasons: [{ code: 'SHORT_NOT_OTM' as const, message: 'Short call is not out of the money' }],
    }));
    expect(summarizePmccLegRejections(rejections)).toEqual([
      { code: 'SHORT_NOT_OTM', message: 'Short call is not out of the money', affectedLegs: 125 },
    ]);
  });
});
