import { describe, expect, it } from 'vitest';
import { HORIZON_VERSION, resolveDecisionHorizon } from '../horizon';

describe('resolveDecisionHorizon', () => {
  it('maps research DTE deterministically', () => {
    expect(resolveDecisionHorizon(7).horizon).toBe('SHORT');
    expect(resolveDecisionHorizon(20).horizon).toBe('SHORT');
    expect(resolveDecisionHorizon(21).horizon).toBe('CORE');
    expect(resolveDecisionHorizon(45).horizon).toBe('CORE');
    expect(resolveDecisionHorizon(46).horizon).toBe('EXTENDED');
    expect(resolveDecisionHorizon(60).horizon).toBe('EXTENDED');
    expect(resolveDecisionHorizon(30).version).toBe(HORIZON_VERSION);
  });

  it('rejects DTE outside the research contract', () => {
    expect(() => resolveDecisionHorizon(6)).toThrow();
    expect(() => resolveDecisionHorizon(61)).toThrow();
  });
});
