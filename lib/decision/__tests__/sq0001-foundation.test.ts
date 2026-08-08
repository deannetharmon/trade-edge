import { describe, expect, it } from 'vitest';
import { calculateMarketFeatures } from '../../market-intelligence/features';
import type { MarketStateEvidence, PointInTimeBar } from '../../market-intelligence/types';
import { evaluateEventRisk } from '../event-risk';
import { classifySetup } from '../setup-classifier';
import { evaluateBpsThesis } from '../strategy-thesis/bps';
import { evaluateBcsThesis } from '../strategy-thesis/bcs';
import { evaluateIcThesis } from '../strategy-thesis/ic';
import { evaluateStrategyEligibility } from '../strategy-eligibility';

const bars = (count: number): PointInTimeBar[] => Array.from({ length: count }, (_, i) => ({
  t: i,
  o: 100 + i,
  h: 103 + i,
  l: 98 + i,
  c: 101 + i,
}));

const evidence = (overrides: Partial<MarketStateEvidence> = {}): MarketStateEvidence => ({
  direction: 'BULLISH',
  strength: 0.5,
  persistence: 0.8,
  regime: 'TREND',
  maturity: 'ESTABLISHED',
  uncertainty: 0.2,
  features: calculateMarketFeatures(bars(60)),
  supportingEvidence: [],
  contradictingEvidence: [],
  ...overrides,
});

describe('SQ-0001A foundation invariants', () => {
  it('keeps range width and range position as different semantics', () => {
    const features = calculateMarketFeatures(bars(60));
    expect(features.range60WidthPct).not.toBeNull();
    expect(features.range60Position).not.toBeNull();
    expect(features.range60WidthPct).not.toBe(features.range60Position);
  });

  it('does not manufacture MA200 from fewer than 200 bars', () => {
    expect(calculateMarketFeatures(bars(199)).ma200.value).toBeNull();
    expect(calculateMarketFeatures(bars(200)).ma200.value).not.toBeNull();
  });

  it('excludes event knowledge learned after T0', () => {
    const risk = evaluateEventRisk({
      evaluatedAt: '2026-07-01T14:00:00.000Z',
      horizonEnd: '2026-08-01T14:00:00.000Z',
      events: [{
        eventType: 'EARNINGS',
        effectiveAt: '2026-07-20T20:00:00.000Z',
        knownAt: '2026-07-02T14:00:00.000Z',
        source: 'test',
      }],
    });
    expect(risk.hasKnownBinaryEvent).toBe(false);
  });

  it('treats BPS and BCS independently rather than by a shared strategy result', () => {
    const state = evidence({ direction: 'BULLISH' });
    const setup = classifySetup(state);
    expect(evaluateBpsThesis('CORE', state, setup).evidenceState).toBe('SUPPORTIVE');
    expect(evaluateBcsThesis('CORE', state, setup).evidenceState).toBe('CONTRADICTORY');
  });

  it('requires IC to preserve side-specific weakness', () => {
    const state = evidence({ direction: 'BULLISH' });
    const thesis = evaluateIcThesis('CORE', state, classifySetup(state));
    expect(thesis.upperContainment).toBe('WEAK');
    expect(thesis.weakerSide).toBe('UPPER');
    expect(thesis.evidenceState).toBe('CONTRADICTORY');
  });

  it('keeps insufficient evidence categorical at eligibility', () => {
    const state = evidence({ direction: 'UNCERTAIN', regime: 'TRANSITION' });
    const thesis = evaluateBpsThesis('CORE', state, classifySetup(state));
    const eligibility = evaluateStrategyEligibility({
      thesis,
      horizon: thesis.horizon,
      eventRisk: { hasKnownBinaryEvent: false },
      modelVersion: 'sq0001-foundation',
      configVersion: 'research-v1',
    });
    expect(eligibility.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('blocks otherwise supportive thesis when a known binary event is in horizon', () => {
    const state = evidence({ direction: 'BULLISH' });
    const thesis = evaluateBpsThesis('CORE', state, classifySetup(state));
    const eligibility = evaluateStrategyEligibility({
      thesis,
      horizon: thesis.horizon,
      eventRisk: { hasKnownBinaryEvent: true, eventType: 'EARNINGS' },
      modelVersion: 'sq0001-foundation',
      configVersion: 'research-v1',
    });
    expect(eligibility.status).toBe('INELIGIBLE');
    expect(eligibility.reasonCodes).toContain('KNOWN_BINARY_EVENT_IN_HORIZON');
  });
});
