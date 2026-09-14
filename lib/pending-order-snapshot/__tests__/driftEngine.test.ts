import { describe, it, expect } from 'vitest';
import { computeDrift, MIN_TICK_FLOOR, MIN_GAP_PCT, MIN_ELAPSED_MINUTES } from '../driftEngine';

describe('computeDrift', () => {
  describe('the 30-minute gate', () => {
    it('gathers data below the minimum elapsed time, regardless of how much the reference moved', () => {
      const result = computeDrift({
        requestedPrice: 1.85, priceEffect: 'Credit',
        referenceAtPlacement: 1.40, currentReference: 1.00, // a huge move
        minutesElapsed: 6,
      });
      expect(result.gatheringData).toBe(true);
      expect(result.minutesRemaining).toBe(24);
      expect(result.clearsThreshold).toBe(false);
      expect(result.favorability).toBeNull();
      expect(result.recommendedPrice).toBeNull();
    });

    it('stops gathering data at exactly the minimum elapsed time', () => {
      const result = computeDrift({
        requestedPrice: 1.85, priceEffect: 'Credit',
        referenceAtPlacement: 1.40, currentReference: 1.40,
        minutesElapsed: MIN_ELAPSED_MINUTES,
      });
      expect(result.gatheringData).toBe(false);
    });
  });

  describe("Quinn's three-path threshold requirement (AND, not OR)", () => {
    // MRVL example from the ticket: $1.85 ask, $1.40 reference, $0.45 gap.
    // 15% of gap = $0.0675 (rounds to ~$0.07), tick floor = $0.10.
    // The tick floor is the harder bar here, so $0.10 governs.

    it('path 1: a move below BOTH thresholds is correctly ignored', () => {
      const result = computeDrift({
        requestedPrice: 1.85, priceEffect: 'Credit',
        referenceAtPlacement: 1.40, currentReference: 1.35, // moved $0.05 -- below the $0.10 floor
        minutesElapsed: 60,
      });
      expect(result.movedAmount).toBeCloseTo(0.05, 5);
      expect(result.clearsThreshold).toBe(false);
      expect(result.favorability).toBeNull();
      expect(result.recommendedPrice).toBeNull();
    });

    it('path 2: a move that clears only the tick floor but not the gap percentage is still ignored', () => {
      // Construct a case where the $0.10 floor is cleared but 15% of the
      // (now-changing) gap is not -- a wide starting gap where 15% is
      // itself much larger than $0.10, so a $0.12 move clears the floor
      // but not the percentage bar.
      const result = computeDrift({
        requestedPrice: 5.00, priceEffect: 'Credit',
        referenceAtPlacement: 1.00, currentReference: 1.12, // moved $0.12 -- clears the $0.10 floor
        minutesElapsed: 60,
      });
      // gap after move = |5.00 - 1.12| = 3.88; 15% of that = 0.582 -- far
      // above the $0.12 actual move, so this must NOT clear threshold.
      expect(result.movedAmount).toBeCloseTo(0.12, 5);
      expect(result.clearsThreshold).toBe(false);
      expect(result.favorability).toBeNull();
      expect(result.recommendedPrice).toBeNull();
    });

    it('path 2b: a move that clears only the gap percentage but not the tick floor is still ignored', () => {
      // A tight gap where 15% is smaller than the $0.10 floor, and the
      // move clears that small percentage but not the floor itself.
      const result = computeDrift({
        requestedPrice: 1.50, priceEffect: 'Credit',
        referenceAtPlacement: 1.40, currentReference: 1.42, // moved $0.02
        minutesElapsed: 60,
      });
      // gap after move = |1.50 - 1.42| = 0.08; 15% of that = 0.012 -- the
      // $0.02 move clears that, but not the $0.10 tick floor.
      expect(result.movedAmount).toBeCloseTo(0.02, 5);
      expect(result.clearsThreshold).toBe(false);
    });

    it('path 3: a move that clears BOTH thresholds fires', () => {
      const result = computeDrift({
        requestedPrice: 1.85, priceEffect: 'Credit',
        referenceAtPlacement: 1.40, currentReference: 1.60, // moved $0.20, toward the ask
        minutesElapsed: 240,
      });
      expect(result.movedAmount).toBeCloseTo(0.20, 5);
      expect(result.clearsThreshold).toBe(true);
      expect(result.favorability).toBe('MORE_FAVORABLE');
      expect(result.recommendedPrice).toBe(1.73); // halfway between 1.85 and 1.60 ($1.725), rounded to the cent
    });
  });

  describe('direction relative to the trader\u2019s own price, not raw sign', () => {
    it('for a Credit order, the reference rising toward the ask is favorable', () => {
      const result = computeDrift({
        requestedPrice: 1.85, priceEffect: 'Credit',
        referenceAtPlacement: 1.40, currentReference: 1.60,
        minutesElapsed: 60,
      });
      expect(result.direction).toBe('TOWARD');
    });

    it('for a Credit order, the reference falling further below the ask is unfavorable', () => {
      const result = computeDrift({
        requestedPrice: 1.85, priceEffect: 'Credit',
        referenceAtPlacement: 1.40, currentReference: 1.20,
        minutesElapsed: 60,
      });
      expect(result.direction).toBe('AWAY');
      expect(result.favorability).toBe('LESS_FAVORABLE');
    });

    it('for a Debit order, the reference falling toward the ask is favorable', () => {
      const result = computeDrift({
        requestedPrice: 1.20, priceEffect: 'Debit',
        referenceAtPlacement: 1.60, currentReference: 1.40,
        minutesElapsed: 60,
      });
      expect(result.direction).toBe('TOWARD');
    });

    it('for a Debit order, the reference rising further above the ask is unfavorable', () => {
      const result = computeDrift({
        requestedPrice: 1.20, priceEffect: 'Debit',
        referenceAtPlacement: 1.40, currentReference: 1.60,
        minutesElapsed: 60,
      });
      expect(result.direction).toBe('AWAY');
      expect(result.favorability).toBe('LESS_FAVORABLE');
    });
  });

  describe('sub-threshold moves never carry a favorability verdict (Dean/Quinn/Ian\u2019s consolidation)', () => {
    it('a small, sub-threshold move reports the direction internally but favorability stays null', () => {
      const result = computeDrift({
        requestedPrice: 1.85, priceEffect: 'Credit',
        referenceAtPlacement: 1.40, currentReference: 1.35,
        minutesElapsed: 60,
      });
      expect(result.direction).toBe('AWAY'); // true, but must not surface as a badge
      expect(result.favorability).toBeNull();
    });
  });

  it('reports the harder-to-clear threshold as thresholdUsed, for the reasoning sentence to display', () => {
    const wideGap = computeDrift({
      requestedPrice: 5.00, priceEffect: 'Credit',
      referenceAtPlacement: 1.00, currentReference: 1.12,
      minutesElapsed: 60,
    });
    // 15% of a ~3.88-4.00 gap is far larger than the $0.10 floor.
    expect(wideGap.thresholdUsed).toBeGreaterThan(MIN_TICK_FLOOR);

    const tightGap = computeDrift({
      requestedPrice: 1.85, priceEffect: 'Credit',
      referenceAtPlacement: 1.40, currentReference: 1.35,
      minutesElapsed: 60,
    });
    // 15% of a ~$0.45-0.50 gap (~$0.07) is smaller than the $0.10 floor.
    expect(tightGap.thresholdUsed).toBe(MIN_TICK_FLOOR);
  });
});
