import { describe, expect, it } from 'vitest';
import {
  buildOriginalCreditDefaultPolicy,
  buildCurrentValueAnchoredPolicy,
  buildManualAbsolutePolicy,
  buildUnknownProvenancePolicy,
  classifyStopLossPolicy,
  describeStopLossPolicy,
  evaluateStopBreach,
  isWithinStopGracePeriod,
  type BreachObservation,
  type StopLossPolicy,
} from '../stopLossPolicy';

describe('classifyStopLossPolicy', () => {
  // 1. MU-style 5-lot BPS: credit $2.52/contract, working stop $3.15 (1.25x
  // credit), no TradeEdge-recorded policy for this order.
  it('never classifies a materially tight, unrecorded stop as aligned', () => {
    const result = classifyStopLossPolicy({
      hasStopOrder: true,
      orderTriggerPrice: 3.15,
      policy: null,
      creditPerContract: 2.52,
    });
    expect(['TOO_TIGHT', 'UNKNOWN_PROVENANCE']).toContain(result);
    expect(result).not.toBe('ALIGNED');
  });

  // 2. Same position, correctly recorded 2x-credit stop at $5.04.
  it('classifies a correctly recorded 2x-credit stop as aligned', () => {
    const policy = buildOriginalCreditDefaultPolicy(2.52, { source: 'DEFAULT' });
    expect(policy.triggerPrice).toBe(5.04);
    const result = classifyStopLossPolicy({
      hasStopOrder: true,
      orderTriggerPrice: 5.04,
      policy,
      creditPerContract: 2.52,
    });
    expect(result).toBe('ALIGNED');
  });

  it('reports NO_STOP when there is no working stop order', () => {
    expect(classifyStopLossPolicy({
      hasStopOrder: false, orderTriggerPrice: null, policy: null, creditPerContract: 2.52,
    })).toBe('NO_STOP');
  });

  it('reports INVALID for an unparseable/non-positive trigger price', () => {
    expect(classifyStopLossPolicy({
      hasStopOrder: true, orderTriggerPrice: NaN, policy: null, creditPerContract: 2.52,
    })).toBe('INVALID');
    expect(classifyStopLossPolicy({
      hasStopOrder: true, orderTriggerPrice: 0, policy: null, creditPerContract: 2.52,
    })).toBe('INVALID');
  });

  it('flags a recorded ORIGINAL_CREDIT policy far below 2x as too tight, not aligned', () => {
    const policy: StopLossPolicy = {
      triggerPrice: 3.15, anchorBasis: 'ORIGINAL_CREDIT', anchorValue: 2.52, multiple: 1.25,
      source: 'MANUAL', createdAt: '2026-01-01T00:00:00.000Z', brokerOrderId: 'ord-1',
      complexOrderId: null,
    };
    const result = classifyStopLossPolicy({
      hasStopOrder: true, orderTriggerPrice: 3.15, policy, creditPerContract: 2.52,
    });
    expect(result).toBe('TOO_TIGHT');
  });

  it('flags a recorded ORIGINAL_CREDIT policy far above 2x as too loose', () => {
    const policy: StopLossPolicy = {
      triggerPrice: 7.56, anchorBasis: 'ORIGINAL_CREDIT', anchorValue: 2.52, multiple: 3,
      source: 'MANUAL', createdAt: '2026-01-01T00:00:00.000Z', brokerOrderId: 'ord-1',
      complexOrderId: null,
    };
    const result = classifyStopLossPolicy({
      hasStopOrder: true, orderTriggerPrice: 7.56, policy, creditPerContract: 2.52,
    });
    expect(result).toBe('TOO_LOOSE');
  });

  it('does not judge an explicitly recorded CURRENT_SPREAD_VALUE policy against the 2x-credit yardstick', () => {
    const policy = buildCurrentValueAnchoredPolicy(1.0, 2.5, { source: 'AI_SUGGESTION' });
    const result = classifyStopLossPolicy({
      hasStopOrder: true, orderTriggerPrice: policy.triggerPrice, policy, creditPerContract: 2.52,
    });
    expect(result).toBe('ALIGNED');
  });

  it('classifies a manual absolute policy as aligned when internally consistent', () => {
    const policy = buildManualAbsolutePolicy(4.0);
    const result = classifyStopLossPolicy({
      hasStopOrder: true, orderTriggerPrice: 4.0, policy, creditPerContract: 2.52,
    });
    expect(result).toBe('ALIGNED');
  });

  it('flags an internally inconsistent recorded policy as invalid', () => {
    const policy: StopLossPolicy = {
      triggerPrice: 9.99, anchorBasis: 'ORIGINAL_CREDIT', anchorValue: 2.52, multiple: 2,
      source: 'DEFAULT', createdAt: null, brokerOrderId: 'ord-1',
      complexOrderId: null,
    };
    const result = classifyStopLossPolicy({
      hasStopOrder: true, orderTriggerPrice: 9.99, policy, creditPerContract: 2.52,
    });
    expect(result).toBe('INVALID');
  });

  // 9. Externally created broker stop with no TradeEdge metadata.
  it('classifies an externally created stop with no metadata as unknown provenance when not materially tight', () => {
    const result = classifyStopLossPolicy({
      hasStopOrder: true, orderTriggerPrice: 5.00, policy: null, creditPerContract: 2.52,
    });
    expect(result).toBe('UNKNOWN_PROVENANCE');
  });

  it('treats a recorded policy whose brokerOrderId no longer matches the live order as unknown/too-tight, not a stale label', () => {
    const stalePolicy = buildOriginalCreditDefaultPolicy(2.52); // $5.04
    // Live order price has drifted away from the recorded policy entirely.
    const result = classifyStopLossPolicy({
      hasStopOrder: true, orderTriggerPrice: 3.15, policy: stalePolicy, creditPerContract: 2.52,
    });
    expect(result).not.toBe('ALIGNED');
  });
});

describe('describeStopLossPolicy', () => {
  it('renders original-credit policies as "N.N× original credit"', () => {
    expect(describeStopLossPolicy(buildOriginalCreditDefaultPolicy(2.52))).toBe('2.0× original credit');
  });

  it('renders current-value policies as "N.N× current spread value at creation"', () => {
    expect(describeStopLossPolicy(buildCurrentValueAnchoredPolicy(1.0, 2.5))).toBe('2.5× current spread value at creation');
  });

  it('renders manual absolute stops distinctly', () => {
    expect(describeStopLossPolicy(buildManualAbsolutePolicy(4.0))).toBe('Manual absolute stop');
  });

  it('never fabricates a "×credit" label for unknown-provenance stops', () => {
    const label = describeStopLossPolicy(buildUnknownProvenancePolicy(3.15, 'ord-99'));
    expect(label).toBe('Basis unknown — broker order not created by TradeEdge');
    expect(label).not.toMatch(/×\s*credit/i);
  });

  it('renders "No stop order" when there is no policy', () => {
    expect(describeStopLossPolicy(null)).toBe('No stop order');
  });
});

describe('evaluateStopBreach', () => {
  const shortQty = 5;
  const policy = buildOriginalCreditDefaultPolicy(2.52); // triggerPrice 5.04
  const thresholdTotal = policy.triggerPrice * 100 * shortQty; // 2520

  const obs = (
    at: string,
    midValue: number | null,
    marketableValue: number | null,
    preciseTimestamp = true
  ): BreachObservation => ({ at, midValue, marketableValue, preciseTimestamp });

  it('returns NO_STOP when there is no policy', () => {
    const result = evaluateStopBreach({ policy: null, quantity: shortQty, observations: [] });
    expect(result.state).toBe('NO_STOP');
  });

  // 3. Wide-market fresh position: midpoint below stop, marketable above,
  // favorable buffer, no confirmation history -- must not be CUT_LOSSES.
  it('downgrades a single wide-market marketable breach with no history to VERIFY_STOP, not confirmed', () => {
    const result = evaluateStopBreach({
      policy,
      quantity: shortQty,
      observations: [obs('2026-08-05T14:00:00.000Z', thresholdTotal - 50, thresholdTotal + 20)],
      quoteQuality: 'DEGRADED',
    });
    expect(result.state).toBe('VERIFY_STOP');
    expect(result.state).not.toBe('CONFIRMED_BREACH');
  });

  // 4. Marketable value above stop solely because of a wide bid/ask spread
  // (mid never breaches) -- no immediate hard exit even with more history.
  it('never confirms breach from marketable-only evidence under degraded quote quality', () => {
    const observations: BreachObservation[] = Array.from({ length: 5 }, (_, i) =>
      obs(`2026-08-0${i + 1}T14:00:00.000Z`, thresholdTotal - 100, thresholdTotal + 30));
    const result = evaluateStopBreach({
      policy, quantity: shortQty, observations, quoteQuality: 'DEGRADED', requiredConfirmations: 2,
    });
    expect(result.state).not.toBe('CONFIRMED_BREACH');
  });

  // 5. Sustained threshold breach across required confirmations with
  // acceptable quote quality -- confirmed CUT_LOSSES-eligible state.
  it('confirms breach after a sustained streak with reliable quote quality', () => {
    const observations: BreachObservation[] = [
      obs('2026-08-01T14:00:00.000Z', thresholdTotal + 10, thresholdTotal + 10),
      obs('2026-08-02T14:00:00.000Z', thresholdTotal + 40, thresholdTotal + 40),
    ];
    const result = evaluateStopBreach({
      policy, quantity: shortQty, observations, quoteQuality: 'RELIABLE', requiredConfirmations: 2,
    });
    expect(result.state).toBe('CONFIRMED_BREACH');
    expect(result.confirmedBy).toBe('OBSERVATION_STREAK');
  });

  // 6. Broker reports the stop order triggered/filled -- confirmed
  // regardless of grace period or observation history.
  it('confirms breach immediately when the broker reports the stop triggered, with zero observations', () => {
    const result = evaluateStopBreach({
      policy, quantity: shortQty, observations: [], brokerStopStatus: 'TRIGGERED',
    });
    expect(result.state).toBe('CONFIRMED_BREACH');
    expect(result.confirmedBy).toBe('BROKER_ORDER');
  });

  // 7. Price briefly crosses and retreats through the hysteresis band --
  // confirmation resets, no stale hard exit.
  it('resets the confirmation streak when price retreats through the hysteresis band', () => {
    const observations: BreachObservation[] = [
      obs('2026-08-01T14:00:00.000Z', thresholdTotal + 10, thresholdTotal + 10), // breached
      obs('2026-08-02T14:00:00.000Z', thresholdTotal + 5, thresholdTotal + 5),   // breached
      // Fully retreats well below the hysteresis floor -- resets the streak.
      obs('2026-08-03T14:00:00.000Z', thresholdTotal * 0.90, thresholdTotal * 0.90),
    ];
    const result = evaluateStopBreach({
      policy, quantity: shortQty, observations, quoteQuality: 'RELIABLE', requiredConfirmations: 2,
    });
    expect(result.state).not.toBe('CONFIRMED_BREACH');
    expect(result.state).toBe('NOT_BREACHED');
  });

  it('downgrades to PENDING_CONFIRMATION when enough history exists but the streak has not yet reached the requirement', () => {
    const observations: BreachObservation[] = [
      obs('2026-08-01T14:00:00.000Z', thresholdTotal - 1000, thresholdTotal - 1000),
      // Within the hysteresis band (not fully retreated) so it doesn't reset,
      // but doesn't itself count as a breach either.
      obs('2026-08-02T14:00:00.000Z', thresholdTotal - 5, thresholdTotal - 5),
      obs('2026-08-03T14:00:00.000Z', thresholdTotal + 5, thresholdTotal + 5),
    ];
    const result = evaluateStopBreach({
      policy, quantity: shortQty, observations, quoteQuality: 'RELIABLE', requiredConfirmations: 3,
    });
    expect(result.state).toBe('PENDING_CONFIRMATION');
  });

  it('reports NOT_BREACHED when the latest observation is below threshold', () => {
    const result = evaluateStopBreach({
      policy, quantity: shortQty,
      observations: [obs('2026-08-01T14:00:00.000Z', thresholdTotal - 500, thresholdTotal - 500)],
      quoteQuality: 'RELIABLE',
    });
    expect(result.state).toBe('NOT_BREACHED');
  });

  // ── TE-0002 corrective round 3: genuine confirmation window ────────────

  it('counts a current read duplicated in today\'s snapshot once, not twice', () => {
    const observations: BreachObservation[] = [
      obs('2026-08-05T14:00:00.000Z', thresholdTotal + 10, thresholdTotal + 10),
      obs('2026-08-05T14:00:00.000Z', thresholdTotal + 10, thresholdTotal + 10),
    ];
    const result = evaluateStopBreach({
      policy, quantity: shortQty, observations, quoteQuality: 'RELIABLE', requiredConfirmations: 2,
    });
    expect(result.streak).toBe(1);
    expect(result.state).not.toBe('CONFIRMED_BREACH');
  });

  it('counts two readings inside the minimum confirmation interval once', () => {
    const observations: BreachObservation[] = [
      obs('2026-08-05T14:00:00.000Z', thresholdTotal + 10, thresholdTotal + 10),
      // Two minutes later -- well inside the 5-minute minimum interval.
      obs('2026-08-05T14:02:00.000Z', thresholdTotal + 15, thresholdTotal + 15),
    ];
    const result = evaluateStopBreach({
      policy, quantity: shortQty, observations, quoteQuality: 'RELIABLE', requiredConfirmations: 2,
    });
    expect(result.streak).toBe(1);
    expect(result.state).not.toBe('CONFIRMED_BREACH');
  });

  it('confirms breach from two properly spaced, fresh, reliable, precisely-timed crossings', () => {
    const observations: BreachObservation[] = [
      obs('2026-08-05T09:00:00.000Z', thresholdTotal + 10, thresholdTotal + 10),
      // Six minutes later -- past the 5-minute minimum interval.
      obs('2026-08-05T09:06:00.000Z', thresholdTotal + 20, thresholdTotal + 20),
    ];
    const result = evaluateStopBreach({
      policy, quantity: shortQty, observations, quoteQuality: 'RELIABLE', requiredConfirmations: 2,
    });
    expect(result.state).toBe('CONFIRMED_BREACH');
    expect(result.confirmedBy).toBe('OBSERVATION_STREAK');
    expect(result.streak).toBe(2);
  });

  it('resets the streak after a hysteresis retreat even with otherwise well-spaced precise observations', () => {
    const observations: BreachObservation[] = [
      obs('2026-08-05T09:00:00.000Z', thresholdTotal + 10, thresholdTotal + 10),
      obs('2026-08-05T09:10:00.000Z', thresholdTotal + 20, thresholdTotal + 20),
      // Fully retreats below the hysteresis floor -- breaks the streak.
      obs('2026-08-05T09:20:00.000Z', thresholdTotal * 0.90, thresholdTotal * 0.90),
    ];
    const result = evaluateStopBreach({
      policy, quantity: shortQty, observations, quoteQuality: 'RELIABLE', requiredConfirmations: 2,
    });
    expect(result.state).not.toBe('CONFIRMED_BREACH');
    expect(result.state).toBe('NOT_BREACHED');
  });

  it('never combines an old imprecise daily snapshot with one current tick to fabricate confirmation', () => {
    const observations: BreachObservation[] = [
      // Old date-only daily snapshot, reconstructed at midnight -- not a
      // genuine capture timestamp.
      obs('2026-08-01T00:00:00.000Z', thresholdTotal + 10, thresholdTotal + 10, false),
      // Today's single genuine live read.
      obs('2026-08-05T14:00:00.000Z', thresholdTotal + 15, thresholdTotal + 15, true),
    ];
    const result = evaluateStopBreach({
      policy, quantity: shortQty, observations, quoteQuality: 'RELIABLE', requiredConfirmations: 2,
    });
    expect(result.state).not.toBe('CONFIRMED_BREACH');
    expect(result.streak).toBe(1);
  });

  it('treats a broker-reported trigger/fill as immediately authoritative regardless of observation freshness', () => {
    const observations: BreachObservation[] = [
      obs('2026-08-01T00:00:00.000Z', thresholdTotal - 500, thresholdTotal - 500, false),
    ];
    const result = evaluateStopBreach({
      policy, quantity: shortQty, observations, quoteQuality: 'DEGRADED', brokerStopStatus: 'TRIGGERED',
    });
    expect(result.state).toBe('CONFIRMED_BREACH');
    expect(result.confirmedBy).toBe('BROKER_ORDER');
  });
});

describe('isWithinStopGracePeriod', () => {
  it('is true for a position opened within the grace window', () => {
    expect(isWithinStopGracePeriod('2026-08-05', '2026-08-05T12:00:00.000Z', 1)).toBe(true);
  });

  it('is false for a position opened well before the grace window', () => {
    expect(isWithinStopGracePeriod('2026-07-01', '2026-08-05T12:00:00.000Z', 1)).toBe(false);
  });

  it('is false when entryDate is missing', () => {
    expect(isWithinStopGracePeriod(null, '2026-08-05T12:00:00.000Z', 1)).toBe(false);
  });
});
