import { describe, expect, it } from 'vitest';
import { calculateMarketFeatures } from '../../market-intelligence/features';
import type { MarketStateEvidence, PointInTimeBar } from '../../market-intelligence/types';
import { evaluateEventRisk } from '../event-risk';
import { classifySetup } from '../setup-classifier';
import { evaluateBpsThesis } from '../strategy-thesis/bps';
import { evaluateBcsThesis } from '../strategy-thesis/bcs';
import { evaluateIcThesis } from '../strategy-thesis/ic';
import { evaluateCspThesis } from '../strategy-thesis/csp';
import { evaluateCcThesis } from '../strategy-thesis/cc';
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

  // CSP-WORKFLOW-RECONCILE-0002 — the CSP thesis adapter.
  describe('CSP thesis adapter', () => {
    it('is a genuinely independent function from BPS, not a call-through, even though both are downside-threatened', () => {
      expect(evaluateCspThesis).not.toBe(evaluateBpsThesis);
    });

    it('is contradicted by bearish underlying evidence, same as BPS -- both share the same threatened side', () => {
      const state = evidence({ direction: 'BEARISH' });
      const setup = classifySetup(state);
      const cspThesis = evaluateCspThesis('CORE', state, setup);
      expect(cspThesis.strategy).toBe('CSP');
      expect(cspThesis.threatenedSide).toBe('DOWNSIDE');
      expect(cspThesis.evidenceState).toBe('CONTRADICTORY');
      expect(cspThesis.contradictingEvidence.some(reason => /cash-secured put/i.test(reason))).toBe(true);
    });

    it('is contradicted by a chaotic setup', () => {
      const state = evidence({ direction: 'UNCERTAIN', regime: 'CHAOTIC' });
      const setup = classifySetup(state);
      expect(setup.setup).toBe('NO_TRADE_CHAOTIC');
      expect(evaluateCspThesis('CORE', state, setup).evidenceState).toBe('CONTRADICTORY');
    });

    it('is supportive on bullish or range evidence', () => {
      const bullish = evidence({ direction: 'BULLISH' });
      expect(evaluateCspThesis('CORE', bullish, classifySetup(bullish)).evidenceState).toBe('SUPPORTIVE');

      const range = evidence({ direction: 'NEUTRAL', persistence: 0.4, regime: 'RANGE' });
      expect(evaluateCspThesis('CORE', range, classifySetup(range)).evidenceState).toBe('SUPPORTIVE');
    });

    it('produces its own CSP-specific evidence text distinct from BPS -- proving this is not BPS output relabeled', () => {
      const state = evidence({ direction: 'BULLISH' });
      const setup = classifySetup(state);
      const bpsSupport = evaluateBpsThesis('CORE', state, setup).supportingEvidence;
      const cspSupport = evaluateCspThesis('CORE', state, setup).supportingEvidence;
      expect(cspSupport).not.toEqual(bpsSupport);
    });
  });

  // CSP-WORKFLOW-RECONCILE-0002 — required gating regression tests proving
  // the SQ-0001A foundation gate blocks CSP before contract ranking,
  // remains categorical for insufficient evidence, and cannot be
  // overridden by contract economics (premium/ROC) or account-capital
  // state. The economics/capital side of these proofs lives at the
  // findAllCsp() layer -- lib/scans/__tests__/cspFoundationGate.test.ts --
  // since premium/ROC/capital don't exist at this pure-thesis layer; this
  // file proves the thesis->eligibility gate itself is correct.
  describe('CSP foundation eligibility gate', () => {
    it('blocks CSP (INELIGIBLE) on bearish underlying evidence', () => {
      const state = evidence({ direction: 'BEARISH' });
      const thesis = evaluateCspThesis('CORE', state, classifySetup(state));
      const eligibility = evaluateStrategyEligibility({
        thesis, horizon: thesis.horizon, eventRisk: { hasKnownBinaryEvent: false },
        modelVersion: 'sq0001-foundation', configVersion: 'research-v1',
      });
      expect(eligibility.status).toBe('INELIGIBLE');
      expect(eligibility.strategy).toBe('CSP');
    });

    it('blocks CSP (INELIGIBLE) on a chaotic setup', () => {
      const state = evidence({ direction: 'UNCERTAIN', regime: 'CHAOTIC' });
      const thesis = evaluateCspThesis('CORE', state, classifySetup(state));
      const eligibility = evaluateStrategyEligibility({
        thesis, horizon: thesis.horizon, eventRisk: { hasKnownBinaryEvent: false },
        modelVersion: 'sq0001-foundation', configVersion: 'research-v1',
      });
      expect(eligibility.status).toBe('INELIGIBLE');
    });

    it('keeps insufficient CSP evidence categorically distinct from INELIGIBLE', () => {
      const state = evidence({ direction: 'UNCERTAIN', regime: 'TRANSITION' });
      const thesis = evaluateCspThesis('CORE', state, classifySetup(state));
      expect(thesis.evidenceState).toBe('INSUFFICIENT');
      const eligibility = evaluateStrategyEligibility({
        thesis, horizon: thesis.horizon, eventRisk: { hasKnownBinaryEvent: false },
        modelVersion: 'sq0001-foundation', configVersion: 'research-v1',
      });
      expect(eligibility.status).toBe('INSUFFICIENT_EVIDENCE');
      expect(eligibility.status).not.toBe('INELIGIBLE');
    });

    it('blocks an otherwise-supportive CSP thesis when a known binary event is in horizon', () => {
      const state = evidence({ direction: 'BULLISH' });
      const thesis = evaluateCspThesis('CORE', state, classifySetup(state));
      expect(thesis.evidenceState).toBe('SUPPORTIVE');
      const eligibility = evaluateStrategyEligibility({
        thesis, horizon: thesis.horizon, eventRisk: { hasKnownBinaryEvent: true, eventType: 'EARNINGS' },
        modelVersion: 'sq0001-foundation', configVersion: 'research-v1',
      });
      expect(eligibility.status).toBe('INELIGIBLE');
      expect(eligibility.reasonCodes).toContain('KNOWN_BINARY_EVENT_IN_HORIZON');
    });

    it('is ELIGIBLE when evidence is supportive and there is no known binary event', () => {
      const state = evidence({ direction: 'BULLISH' });
      const thesis = evaluateCspThesis('CORE', state, classifySetup(state));
      const eligibility = evaluateStrategyEligibility({
        thesis, horizon: thesis.horizon, eventRisk: { hasKnownBinaryEvent: false },
        modelVersion: 'sq0001-foundation', configVersion: 'research-v1',
      });
      expect(eligibility.status).toBe('ELIGIBLE');
    });
  });

  // TE-0007C-RECONCILE-0001 — the Covered Call thesis adapter.
  describe('CC thesis adapter', () => {
    it('is a genuinely independent function from both BCS and BPS', () => {
      expect(evaluateCcThesis).not.toBe(evaluateBcsThesis);
      expect(evaluateCcThesis).not.toBe(evaluateBpsThesis);
    });

    it('is contradicted by bullish underlying evidence -- high call-away risk', () => {
      const state = evidence({ direction: 'BULLISH' });
      const setup = classifySetup(state);
      const thesis = evaluateCcThesis('CORE', state, setup);
      expect(thesis.strategy).toBe('CC');
      expect(thesis.evidenceState).toBe('CONTRADICTORY');
      expect(thesis.callAwayRisk).toBe('HIGH');
      expect(thesis.contradictingEvidence.some(r => /called away/i.test(r))).toBe(true);
    });

    it('is supportive on bearish or range evidence -- low call-away risk', () => {
      const bearish = evidence({ direction: 'BEARISH' });
      const bearishThesis = evaluateCcThesis('CORE', bearish, classifySetup(bearish));
      expect(bearishThesis.evidenceState).toBe('SUPPORTIVE');
      expect(bearishThesis.callAwayRisk).toBe('LOW');

      const range = evidence({ direction: 'NEUTRAL', persistence: 0.4, regime: 'RANGE' });
      const rangeThesis = evaluateCcThesis('CORE', range, classifySetup(range));
      expect(rangeThesis.evidenceState).toBe('SUPPORTIVE');
      expect(rangeThesis.callAwayRisk).toBe('LOW');
    });

    it('is contradicted by a chaotic setup, with unknown call-away risk', () => {
      const state = evidence({ direction: 'UNCERTAIN', regime: 'CHAOTIC' });
      const thesis = evaluateCcThesis('CORE', state, classifySetup(state));
      expect(thesis.evidenceState).toBe('CONTRADICTORY');
      expect(thesis.callAwayRisk).toBe('UNKNOWN');
    });

    it('is insufficient on transition/uncertain evidence', () => {
      const state = evidence({ direction: 'UNCERTAIN', regime: 'TRANSITION' });
      const thesis = evaluateCcThesis('CORE', state, classifySetup(state));
      expect(thesis.evidenceState).toBe('INSUFFICIENT');
      expect(thesis.callAwayRisk).toBe('UNKNOWN');
    });

    it('produces its own CC-specific evidence text, not BCS text relabeled', () => {
      const state = evidence({ direction: 'BULLISH' });
      const setup = classifySetup(state);
      const bcsContradict = evaluateBcsThesis('CORE', state, setup).contradictingEvidence;
      const ccContradict = evaluateCcThesis('CORE', state, setup).contradictingEvidence;
      expect(ccContradict).not.toEqual(bcsContradict);
    });
  });

  describe('CC foundation eligibility gate', () => {
    it('blocks CC (INELIGIBLE) on bullish underlying evidence (high call-away risk)', () => {
      const state = evidence({ direction: 'BULLISH' });
      const thesis = evaluateCcThesis('CORE', state, classifySetup(state));
      const eligibility = evaluateStrategyEligibility({
        thesis, horizon: thesis.horizon, eventRisk: { hasKnownBinaryEvent: false },
        modelVersion: 'sq0001-foundation', configVersion: 'research-v1',
      });
      expect(eligibility.status).toBe('INELIGIBLE');
      expect(eligibility.strategy).toBe('CC');
    });

    it('keeps insufficient CC evidence categorically distinct from INELIGIBLE', () => {
      const state = evidence({ direction: 'UNCERTAIN', regime: 'TRANSITION' });
      const thesis = evaluateCcThesis('CORE', state, classifySetup(state));
      const eligibility = evaluateStrategyEligibility({
        thesis, horizon: thesis.horizon, eventRisk: { hasKnownBinaryEvent: false },
        modelVersion: 'sq0001-foundation', configVersion: 'research-v1',
      });
      expect(eligibility.status).toBe('INSUFFICIENT_EVIDENCE');
      expect(eligibility.status).not.toBe('INELIGIBLE');
    });

    it('blocks an otherwise-supportive CC thesis when a known binary event is in horizon', () => {
      const state = evidence({ direction: 'BEARISH' });
      const thesis = evaluateCcThesis('CORE', state, classifySetup(state));
      expect(thesis.evidenceState).toBe('SUPPORTIVE');
      const eligibility = evaluateStrategyEligibility({
        thesis, horizon: thesis.horizon, eventRisk: { hasKnownBinaryEvent: true, eventType: 'EARNINGS' },
        modelVersion: 'sq0001-foundation', configVersion: 'research-v1',
      });
      expect(eligibility.status).toBe('INELIGIBLE');
      expect(eligibility.reasonCodes).toContain('KNOWN_BINARY_EVENT_IN_HORIZON');
    });

    it('is ELIGIBLE when evidence is supportive and there is no known binary event', () => {
      const state = evidence({ direction: 'BEARISH' });
      const thesis = evaluateCcThesis('CORE', state, classifySetup(state));
      const eligibility = evaluateStrategyEligibility({
        thesis, horizon: thesis.horizon, eventRisk: { hasKnownBinaryEvent: false },
        modelVersion: 'sq0001-foundation', configVersion: 'research-v1',
      });
      expect(eligibility.status).toBe('ELIGIBLE');
    });
  });

  // TE-0007C-RECONCILE-0001 §18 cross-strategy regression — every strategy
  // now integrated with SQ-0001A must coexist without collision.
  it('evaluateUnderlyingFoundation-equivalent set now spans BPS, BCS, IC, CSP, and CC with no cross-strategy leakage', () => {
    const state = evidence({ direction: 'BULLISH' });
    const setup = classifySetup(state);
    const strategies = [
      evaluateBpsThesis('CORE', state, setup).strategy,
      evaluateBcsThesis('CORE', state, setup).strategy,
      evaluateIcThesis('CORE', state, setup).strategy,
      evaluateCspThesis('CORE', state, setup).strategy,
      evaluateCcThesis('CORE', state, setup).strategy,
    ];
    expect(new Set(strategies)).toEqual(new Set(['BPS', 'BCS', 'IC', 'CSP', 'CC']));
  });
});
