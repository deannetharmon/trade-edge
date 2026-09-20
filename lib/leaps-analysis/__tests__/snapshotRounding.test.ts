// lib/leaps-analysis/__tests__/snapshotRounding.test.ts
//
// The snapshot the model reads carries display-precision numbers: broker floats such as 12.692000000000007 or
// 2.3778071334214026 were showing up verbatim in the analysis evidence.

import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../analysisService';
import { evaluateLeapsEntry } from '@/lib/scans/leapsEntryQualification';
import { SERVER_LEAPS_POLICY, type ServerLeapsReview } from '../serverTradeReview';

const NOW = '2026-09-21T15:00:00.000Z';
const qualification = evaluateLeapsEntry({
  occSymbol: 'GOOGL 270617C00250000', strike: 250, dte: 270, delta: 0.84569266, openInterest: 1296, bid: 112.2, ask: 114.9, underlyingPrice: 350.858, quoteTimestamp: NOW,
}, SERVER_LEAPS_POLICY);

const review: ServerLeapsReview = {
  qualification, occSymbol: 'GOOGL 270617C00250000', symbol: 'GOOGL', strike: 250, expiration: '2027-06-17', dte: 270,
  bid: 112.2, ask: 114.9, spot: 350.858, delta: 0.84569266, openInterest: 1296, impliedVolatility: 0.485456995,
  optionQuoteTimestamp: NOW, underlyingQuoteTimestamp: NOW, instrumentType: 'Equity Option', multiplier: 100, provider: 'tastytrade',
  fetchedAt: NOW, marketSession: 'open', quoteBasis: 'live',
};

describe('buildSnapshot display precision', () => {
  const snapshot = buildSnapshot(review, 'not_specified', 1, '');

  it('rounds money and percentage mechanics to 2 decimals', () => {
    expect(snapshot.mechanics).toMatchObject({
      multiplier: 100, midPerShare: 113.55, costPerContract: 11355, totalEstimatedCost: 11355,
      intrinsicPerShare: 100.86, extrinsicPerShare: 12.69, extrinsicPctOfMidCost: 11.18, breakeven: 363.55, breakevenPctAboveSpot: 3.62, spreadPct: 2.38,
    });
  });

  it('rounds delta and implied volatility to 4 decimals and leaves broker prices untouched', () => {
    expect(snapshot.contract.delta).toBe(0.8457);
    expect(snapshot.contract.impliedVolatility).toBe(0.4855);
    expect(snapshot.contract).toMatchObject({ bid: 112.2, ask: 114.9, spot: 350.858, strike: 250, openInterest: 1296 });
  });

  it('rounds the percentages carried on the qualification but never changes its status or gates', () => {
    expect(snapshot.qualification.extrinsicPctOfCost).toBe(11.18);
    expect(snapshot.qualification.spreadPct).toBe(2.38);
    expect(snapshot.qualification.status).toBe(qualification.status);
    expect(snapshot.qualification.gates).toEqual(qualification.gates);
  });

  it('keeps null values null and does not mutate the review', () => {
    const noQuote = buildSnapshot({ ...review, bid: null, ask: null, delta: null, impliedVolatility: null }, 'not_specified', 1, '');
    expect(noQuote.mechanics.midPerShare).toBeNull();
    expect(noQuote.contract.delta).toBeNull();
    expect(review.delta).toBe(0.84569266);
    expect(review.qualification.spreadPct).toBe(qualification.spreadPct);
  });
});
