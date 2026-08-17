// lib/portfolio/__tests__/trendClassification.test.ts
//
// PMCC-TREND-GATE-0001 / fix/cc-not-bearish-trend-classification --
// technicalAlignmentForStrategy shipped twice (PI-0006B-FOLLOWUP, then
// as this ticket's own gate) with zero test coverage, and in that gap a
// real production bug shipped silently: CC (covered call) was classified
// as bearish, so any covered call held on an uptrending stock was
// flagged "trend against" -- nudging the portfolio recommendation engine
// toward Cut Losses/Reduce Risk on positions whose bullish thesis was
// fully intact. Found via a concrete trader example (AVGO wheel), not by
// a test -- these cases exist so the next classification error doesn't
// have to wait for another real-money example to surface it.

import { technicalAlignmentForStrategy, classifyTrendFromCloses } from '../trendClassification';

describe('technicalAlignmentForStrategy', () => {
  describe('PMCC -- bullish strategy', () => {
    it('downtrend is against PMCC\'s bullish thesis', () => {
      expect(technicalAlignmentForStrategy('downtrend', 'PMCC')).toBe('against');
    });
    it('uptrend is aligned with PMCC\'s bullish thesis', () => {
      expect(technicalAlignmentForStrategy('uptrend', 'PMCC')).toBe('aligned');
    });
    it('sideways trend is neutral, not against', () => {
      expect(technicalAlignmentForStrategy('sideways', 'PMCC')).toBe('neutral');
    });
    it('unknown trend is unknown, never gates', () => {
      expect(technicalAlignmentForStrategy('unknown', 'PMCC')).toBe('unknown');
    });
  });

  describe('CC -- income overlay, not a directional bet (the AVGO/wheel case)', () => {
    it('uptrend is neutral for CC -- this was the real bug: previously classified against', () => {
      expect(technicalAlignmentForStrategy('uptrend', 'CC')).toBe('neutral');
    });
    it('downtrend is also neutral for CC -- direction-agnostic in both directions', () => {
      expect(technicalAlignmentForStrategy('downtrend', 'CC')).toBe('neutral');
    });
  });

  describe('BCS -- genuinely bearish, profits from decline or stall', () => {
    it('uptrend is against BCS -- a real structural conflict CC does not share', () => {
      expect(technicalAlignmentForStrategy('uptrend', 'BCS')).toBe('against');
    });
    it('downtrend is aligned with BCS', () => {
      expect(technicalAlignmentForStrategy('downtrend', 'BCS')).toBe('aligned');
    });
  });

  describe('BPS/CSP -- bullish strategies, same treatment as PMCC', () => {
    it('downtrend is against BPS', () => {
      expect(technicalAlignmentForStrategy('downtrend', 'BPS')).toBe('against');
    });
    it('uptrend is aligned with CSP', () => {
      expect(technicalAlignmentForStrategy('uptrend', 'CSP')).toBe('aligned');
    });
  });

  describe('IC and unrecognized strategies -- trend-agnostic by design', () => {
    it('IC is neutral regardless of trend direction', () => {
      expect(technicalAlignmentForStrategy('uptrend', 'IC')).toBe('neutral');
      expect(technicalAlignmentForStrategy('downtrend', 'IC')).toBe('neutral');
    });
  });

  describe('missing inputs fail closed to unknown, never a false positive', () => {
    it('null strategy is unknown', () => {
      expect(technicalAlignmentForStrategy('uptrend', null)).toBe('unknown');
    });
    it('undefined strategy is unknown', () => {
      expect(technicalAlignmentForStrategy('uptrend', undefined)).toBe('unknown');
    });
  });
});

describe('classifyTrendFromCloses', () => {
  it('returns unknown with fewer than 90 closes (PMCC-RANK-TREND-WINDOW-0001: 60/90-day window)', () => {
    const closes = Array.from({ length: 89 }, (_, i) => 100 + i);
    expect(classifyTrendFromCloses(closes).trend).toBe('unknown');
  });

  it('classifies a genuine sustained uptrend correctly with 90+ closes', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i * 2);
    expect(classifyTrendFromCloses(closes).trend).toBe('uptrend');
  });

  it('classifies a genuine sustained downtrend correctly with 90+ closes', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 300 - i * 2);
    expect(classifyTrendFromCloses(closes).trend).toBe('downtrend');
  });
});

