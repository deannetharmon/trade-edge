// lib/portfolio-mode/__tests__/guardrails.test.ts
//
// PT-0002A: pure execution/mutation-boundary guardrail coverage. These
// functions are not wired into any call site yet (see guardrails.ts's
// module doc) -- this suite proves the guard logic itself is correct and
// ready, independent of wiring.

import { describe, expect, it } from 'vitest';
import { assertLiveContext, assertPaperContext, PortfolioModeGuardError } from '../guardrails';

describe('assertLiveContext', () => {
  it('does not throw when mode is LIVE', () => {
    expect(() => assertLiveContext('LIVE', 'submit close order')).not.toThrow();
  });

  it('throws PortfolioModeGuardError when mode is PAPER', () => {
    expect(() => assertLiveContext('PAPER', 'submit close order')).toThrow(PortfolioModeGuardError);
  });

  it('the thrown error carries expected/actual/action for the caller to branch on', () => {
    try {
      assertLiveContext('PAPER', 'submit close order');
      throw new Error('expected assertLiveContext to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PortfolioModeGuardError);
      const err = e as PortfolioModeGuardError;
      expect(err.code).toBe('WRONG_MODE');
      expect(err.expected).toBe('LIVE');
      expect(err.actual).toBe('PAPER');
      expect(err.action).toBe('submit close order');
    }
  });
});

describe('assertPaperContext', () => {
  it('does not throw when mode is PAPER', () => {
    expect(() => assertPaperContext('PAPER', 'open paper position')).not.toThrow();
  });

  it('throws PortfolioModeGuardError when mode is LIVE', () => {
    expect(() => assertPaperContext('LIVE', 'open paper position')).toThrow(PortfolioModeGuardError);
  });

  it('the thrown error carries expected/actual/action for the caller to branch on', () => {
    try {
      assertPaperContext('LIVE', 'open paper position');
      throw new Error('expected assertPaperContext to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PortfolioModeGuardError);
      const err = e as PortfolioModeGuardError;
      expect(err.code).toBe('WRONG_MODE');
      expect(err.expected).toBe('PAPER');
      expect(err.actual).toBe('LIVE');
      expect(err.action).toBe('open paper position');
    }
  });
});
