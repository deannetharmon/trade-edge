import { describe, it, expect } from 'vitest';
import { computeLiquidityScore } from '../rank-scoring';

// OI-LIQUIDITY-CHOICE-0001: Quinn's requirement -- pin the OI-to-score
// curve at specific real values, so a future "helpful" tweak to the
// curve or the weights gets caught by a failing test, not silently
// drifted. Credit ratio and ROC held at values that score exactly 1.0
// (0.50 and 35 respectively) in each case, isolating the OI component so
// these numbers directly reflect oiScore * 0.35 at each point.

const FULL_CREDIT_RATIO = 0.50; // clamp((0.50-0.15)/0.35) = 1.0
const FULL_ROC = 35; // clamp(35/35) = 1.0

describe('computeLiquidityScore — pinned OI curve values (Ian: 35% weight)', () => {
  it('OI = 0 scores 0 for the OI component', () => {
    const result = computeLiquidityScore(0, FULL_CREDIT_RATIO, FULL_ROC);
    // oiScore(0) = 0, so liquidity = 0*0.35 + 1.0*0.325 + 1.0*0.325 = 0.65
    expect(result).toBeCloseTo(0.65, 4);
  });

  it('OI = 100 scores the correct curve value (~0.324, not the stale 0.18 comment)', () => {
    const result = computeLiquidityScore(100, FULL_CREDIT_RATIO, FULL_ROC);
    // oiScore(100) = (100/500)^0.7 ≈ 0.3241 -- verified directly, not
    // copied from the source comment, which turned out to be stale/wrong
    // (said 0.18; the actual formula has always computed ~0.324). Fixed
    // the comment in rank-scoring.ts alongside this test.
    const expectedOiScore = Math.pow(100 / 500, 0.7);
    expect(expectedOiScore).toBeCloseTo(0.3241, 3);
    const expected = expectedOiScore * 0.35 + 1.0 * 0.325 + 1.0 * 0.325;
    expect(result).toBeCloseTo(expected, 4);
  });

  it("OI = 300 (Dean's SOXL example is 202, in this same range) scores partway up the curve", () => {
    const result = computeLiquidityScore(300, FULL_CREDIT_RATIO, FULL_ROC);
    const expectedOiScore = Math.pow(300 / 500, 0.7);
    const expected = expectedOiScore * 0.35 + 1.0 * 0.325 + 1.0 * 0.325;
    expect(result).toBeCloseTo(expected, 4);
    // Sanity: this must score strictly better than OI=100 and strictly
    // worse than OI=500, or the curve itself is broken.
    const at100 = computeLiquidityScore(100, FULL_CREDIT_RATIO, FULL_ROC);
    const at500 = computeLiquidityScore(500, FULL_CREDIT_RATIO, FULL_ROC);
    expect(result).toBeGreaterThan(at100);
    expect(result).toBeLessThan(at500);
  });

  it('OI = 500 (the floor) scores full marks — exactly 1.0 overall with full credit/roc', () => {
    const result = computeLiquidityScore(500, FULL_CREDIT_RATIO, FULL_ROC);
    expect(result).toBeCloseTo(1.0, 4);
  });

  it('OI = 1000 (double the floor) scores identically to OI = 500 — the curve caps at the floor', () => {
    const at500 = computeLiquidityScore(500, FULL_CREDIT_RATIO, FULL_ROC);
    const at1000 = computeLiquidityScore(1000, FULL_CREDIT_RATIO, FULL_ROC);
    expect(at1000).toBeCloseTo(at500, 6);
    expect(at1000).toBeCloseTo(1.0, 4);
  });

  it('OI never single-handedly buries a candidate strong on credit ratio and ROC (Ian\u2019s actual goal for the 35% change)', () => {
    // Zero OI, but excellent credit ratio and ROC -- under the OLD 60%
    // weight this candidate would have scored 0*0.6 + 1.0*0.2 + 1.0*0.2 =
    // 0.40. Under the new 35% weight it should score meaningfully higher,
    // proving the rebalance actually changed the outcome, not just the
    // internal math.
    const newWeight = computeLiquidityScore(0, FULL_CREDIT_RATIO, FULL_ROC);
    const oldWeightEquivalent = 0 * 0.6 + 1.0 * 0.2 + 1.0 * 0.2;
    expect(newWeight).toBeGreaterThan(oldWeightEquivalent);
  });

  it('the weight change never lets OI matter MORE than before at the low end — still a real, meaningful drag', () => {
    // At OI=0, the candidate should still score noticeably below a
    // deep-OI equivalent -- the 35% weight must still be a real penalty,
    // not a token one.
    const thin = computeLiquidityScore(0, FULL_CREDIT_RATIO, FULL_ROC);
    const deep = computeLiquidityScore(500, FULL_CREDIT_RATIO, FULL_ROC);
    expect(deep - thin).toBeCloseTo(0.35, 4); // exactly the OI weight, since oiScore swings 0→1
  });

  it('creditRatio and roc are weighted equal to each other, as before', () => {
    // Max out only creditRatio, zero out roc, vs. the reverse -- should
    // score identically given they carry the same weight.
    const creditOnly = computeLiquidityScore(500, FULL_CREDIT_RATIO, 0);
    const rocOnly = computeLiquidityScore(500, 0.15, FULL_ROC); // 0.15 clamps creditRatioScore to 0
    expect(creditOnly).toBeCloseTo(rocOnly, 4);
  });
});
