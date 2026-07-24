// lib/portfolio-mode/__tests__/guardrails.test.ts
//
// PT-0002A: pure execution/mutation-boundary guardrail coverage. These
// functions are not wired into any call site yet (see guardrails.ts's
// module doc) -- this suite proves the guard logic itself is correct and
// ready, independent of wiring.
//
// PT-0002B adds assertLiveContextReady coverage -- see guardrails.ts's PT-0002B
// section and docs/design/PT-0002B-Portfolio-Context-Integration.md §3.1. This
// is now wired into app/portfolio/page.tsx's real broker-submission call sites.

import { describe, expect, it } from 'vitest';
import { assertLiveContext, assertLiveContextReady, assertPaperContext, PortfolioModeGuardError } from '../guardrails';

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

describe('assertLiveContextReady', () => {
  it('does not throw when status is ready and mode is LIVE', () => {
    expect(() => assertLiveContextReady('ready', 'LIVE', 'submit close order')).not.toThrow();
  });

  it('throws PortfolioModeGuardError when status is ready and mode is PAPER', () => {
    expect(() => assertLiveContextReady('ready', 'PAPER', 'submit close order')).toThrow(PortfolioModeGuardError);
  });

  it('throws PortfolioModeGuardError when status is resolving (mode null)', () => {
    expect(() => assertLiveContextReady('resolving', null, 'submit close order')).toThrow(PortfolioModeGuardError);
  });

  it('throws PortfolioModeGuardError when status is invalid (mode null)', () => {
    expect(() => assertLiveContextReady('invalid', null, 'submit close order')).toThrow(PortfolioModeGuardError);
  });

  it('never resolves resolving/invalid to an assumed LIVE mode', () => {
    // Regression guard: a buggy implementation might treat "mode is null" as
    // "no opinion, allow it" -- this must never happen.
    try {
      assertLiveContextReady('resolving', null, 'submit close order');
      throw new Error('expected assertLiveContextReady to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PortfolioModeGuardError);
      const err = e as PortfolioModeGuardError;
      expect(err.expected).toBe('LIVE');
      expect(err.action).toBe('submit close order');
    }
  });
});
