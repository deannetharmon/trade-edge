// lib/discovery/__tests__/lifecycle.test.ts

import { describe, expect, it } from 'vitest';
import {
  ACTIVE_STATES,
  CANDIDATE_STATES,
  TERMINAL_STATES,
  classified,
  insufficientData,
  isOpportunityState,
  isTransitionAllowed,
  resolveNextState,
} from '..';
import type { CandidateState } from '..';

describe('candidate lifecycle states', () => {
  it('defines exactly the six states from Section 19', () => {
    expect(CANDIDATE_STATES).toEqual(['DISCOVERED', 'WATCH', 'SETUP', 'ACTIONABLE', 'INVALIDATED', 'EXPIRED']);
    expect(ACTIVE_STATES).toEqual(['DISCOVERED', 'WATCH', 'SETUP', 'ACTIONABLE']);
    expect(TERMINAL_STATES).toEqual(['INVALIDATED', 'EXPIRED']);
  });

  it('INSUFFICIENT_DATA is an outcome, not a lifecycle state', () => {
    expect((CANDIDATE_STATES as readonly string[]).includes('INSUFFICIENT_DATA')).toBe(false);
    expect(insufficientData(['pe']).kind).toBe('INSUFFICIENT_DATA');
  });

  it('only WATCH / SETUP / ACTIONABLE count as live opportunities', () => {
    expect(CANDIDATE_STATES.filter(isOpportunityState)).toEqual(['WATCH', 'SETUP', 'ACTIONABLE']);
  });
});

describe('transition rules', () => {
  it('allows every move between active states in both directions', () => {
    ACTIVE_STATES.forEach((from) => {
      ACTIVE_STATES.forEach((to) => {
        expect(isTransitionAllowed(from, to)).toBe(from !== to);
      });
    });
  });

  it('allows an active candidate to become INVALIDATED or EXPIRED', () => {
    ACTIVE_STATES.forEach((from) => {
      TERMINAL_STATES.forEach((to) => expect(isTransitionAllowed(from, to)).toBe(true));
    });
  });

  it('allows nothing out of a terminal state', () => {
    TERMINAL_STATES.forEach((from) => {
      CANDIDATE_STATES.forEach((to) => expect(isTransitionAllowed(from, to)).toBe(false));
    });
  });

  it('a first observation can be any active state but not a terminal one', () => {
    ACTIVE_STATES.forEach((to) => expect(isTransitionAllowed(null, to)).toBe(true));
    TERMINAL_STATES.forEach((to) => expect(isTransitionAllowed(null, to)).toBe(false));
  });
});

describe('insufficient-data outcome', () => {
  it('must name what blocked evaluation, deduplicated and sorted', () => {
    expect(() => insufficientData([])).toThrow(/at least one metric/);
    expect(insufficientData(['b', 'a', 'b'])).toEqual({ kind: 'INSUFFICIENT_DATA', missingMetricIds: ['a', 'b'] });
  });

  it('rejects an unknown classified state', () => {
    expect(() => classified('BUY' as CandidateState)).toThrow(/Unknown candidate state/);
  });
});

describe('resolveNextState', () => {
  it('moves an existing candidate to the classified state', () => {
    expect(resolveNextState('WATCH', classified('SETUP'))).toEqual({ state: 'SETUP', changed: true, blockedByTerminalState: false });
    expect(resolveNextState('ACTIONABLE', classified('WATCH'))).toMatchObject({ state: 'WATCH', changed: true });
  });

  it('does not report a change when the classification is the same', () => {
    expect(resolveNextState('SETUP', classified('SETUP'))).toMatchObject({ state: 'SETUP', changed: false });
  });

  it('INSUFFICIENT_DATA never moves an existing candidate', () => {
    ACTIVE_STATES.forEach((state) => {
      expect(resolveNextState(state, insufficientData(['pe']))).toEqual({ state, changed: false, blockedByTerminalState: false });
    });
  });

  it('a new candidate with INSUFFICIENT_DATA is recorded as DISCOVERED', () => {
    expect(resolveNextState(null, insufficientData(['pe']))).toEqual({ state: 'DISCOVERED', changed: true, blockedByTerminalState: false });
  });

  it('a new candidate may be classified directly', () => {
    expect(resolveNextState(null, classified('WATCH'))).toMatchObject({ state: 'WATCH', changed: true });
    expect(() => resolveNextState(null, classified('INVALIDATED'))).toThrow(/first be observed/);
  });

  it('terminal candidates stay terminal and report when a different state was requested', () => {
    expect(resolveNextState('INVALIDATED', classified('SETUP'))).toEqual({ state: 'INVALIDATED', changed: false, blockedByTerminalState: true });
    expect(resolveNextState('EXPIRED', classified('EXPIRED'))).toMatchObject({ changed: false, blockedByTerminalState: false });
    expect(resolveNextState('INVALIDATED', insufficientData(['pe']))).toMatchObject({ changed: false, blockedByTerminalState: false });
  });
});
