import { describe, expect, it } from 'vitest';
import { technicalAlignmentForStrategy } from '../trendClassification';

describe('covered-call trend semantics', () => {
  it.each([
    ['uptrend', 'neutral'],
    ['downtrend', 'neutral'],
    ['sideways', 'neutral'],
    ['unknown', 'unknown'],
  ] as const)('classifies CC + %s as %s', (trend, expected) => {
    expect(technicalAlignmentForStrategy(trend, 'CC')).toBe(expected);
  });

  it('keeps BCS bearish and distinct from CC', () => {
    expect(technicalAlignmentForStrategy('uptrend', 'BCS')).toBe('against');
    expect(technicalAlignmentForStrategy('downtrend', 'BCS')).toBe('aligned');
  });

  it('keeps PMCC bullish', () => {
    expect(technicalAlignmentForStrategy('uptrend', 'PMCC')).toBe('aligned');
    expect(technicalAlignmentForStrategy('downtrend', 'PMCC')).toBe('against');
  });

  it('keeps BPS and CSP bullish', () => {
    expect(technicalAlignmentForStrategy('uptrend', 'BPS')).toBe('aligned');
    expect(technicalAlignmentForStrategy('downtrend', 'BPS')).toBe('against');
    expect(technicalAlignmentForStrategy('uptrend', 'CSP')).toBe('aligned');
    expect(technicalAlignmentForStrategy('downtrend', 'CSP')).toBe('against');
  });

  it('keeps IC direction-neutral', () => {
    expect(technicalAlignmentForStrategy('uptrend', 'IC')).toBe('neutral');
    expect(technicalAlignmentForStrategy('downtrend', 'IC')).toBe('neutral');
  });

  it('fails closed when strategy evidence is missing', () => {
    expect(technicalAlignmentForStrategy('uptrend', null)).toBe('unknown');
    expect(technicalAlignmentForStrategy('uptrend', undefined)).toBe('unknown');
  });
});
