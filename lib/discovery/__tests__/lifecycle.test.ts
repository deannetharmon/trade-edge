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
  lifecycleResolutionProblems,
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
    expect(resolveNextState('WATCH', classified('SETUP'))).toEqual({
      previousState: 'WATCH',
      requestedState: 'SETUP',
      state: 'SETUP',
      changed: true,
      blockedByTerminalState: false,
    });
    expect(resolveNextState('ACTIONABLE', classified('WATCH'))).toMatchObject({ state: 'WATCH', changed: true });
  });

  it('does not report a change when the classification is the same', () => {
    expect(resolveNextState('SETUP', classified('SETUP'))).toMatchObject({ state: 'SETUP', changed: false });
  });

  it('INSUFFICIENT_DATA never moves an existing candidate', () => {
    ACTIVE_STATES.forEach((state) => {
      expect(resolveNextState(state, insufficientData(['pe']))).toEqual({
        previousState: state,
        requestedState: null,
        state,
        changed: false,
        blockedByTerminalState: false,
      });
    });
  });

  it('a new candidate with INSUFFICIENT_DATA is recorded as DISCOVERED', () => {
    expect(resolveNextState(null, insufficientData(['pe']))).toEqual({
      previousState: null,
      requestedState: null,
      state: 'DISCOVERED',
      changed: true,
      blockedByTerminalState: false,
    });
  });

  it('a new candidate may be classified directly', () => {
    expect(resolveNextState(null, classified('WATCH'))).toMatchObject({ state: 'WATCH', changed: true });
    expect(() => resolveNextState(null, classified('INVALIDATED'))).toThrow(/first be observed/);
  });

  it('terminal candidates stay terminal and report when a different state was requested', () => {
    expect(resolveNextState('INVALIDATED', classified('SETUP'))).toEqual({
      previousState: 'INVALIDATED',
      requestedState: 'SETUP',
      state: 'INVALIDATED',
      changed: false,
      blockedByTerminalState: true,
    });
    expect(resolveNextState('EXPIRED', classified('EXPIRED'))).toMatchObject({ changed: false, blockedByTerminalState: false });
    expect(resolveNextState('INVALIDATED', insufficientData(['pe']))).toMatchObject({ changed: false, blockedByTerminalState: false });
  });
});

describe('lifecycleResolutionProblems', () => {
  it('accepts every resolution that resolveNextState can produce', () => {
    const outcomes = [...CANDIDATE_STATES.map((state) => classified(state)), insufficientData(['pe'])];
    const previous: Array<CandidateState | null> = [null, ...CANDIDATE_STATES];
    previous.forEach((from) => {
      outcomes.forEach((outcome) => {
        let resolution;
        try {
          resolution = resolveNextState(from, outcome);
        } catch {
          return; // a new candidate cannot first be observed as a terminal state
        }
        expect(lifecycleResolutionProblems(resolution)).toEqual([]);
      });
    });
  });

  it('rejects a first observation that lands directly in a terminal state (Quinn B3)', () => {
    (['INVALIDATED', 'EXPIRED'] as const).forEach((terminal) => {
      const forged = { previousState: null, requestedState: terminal, state: terminal, changed: true, blockedByTerminalState: false };
      const problems = lifecycleResolutionProblems(forged);
      expect(problems).toContain(`null -> ${terminal} is not an allowed transition.`);
      // resolveNextState itself refuses the same move, so the validator and the state machine agree.
      expect(() => resolveNextState(null, classified(terminal))).toThrow(/first be observed/);
    });
  });

  it('agrees with isTransitionAllowed for every recorded change', () => {
    const previous: Array<CandidateState | null> = [null, ...CANDIDATE_STATES];
    previous.forEach((from) => {
      CANDIDATE_STATES.forEach((to) => {
        const forged = { previousState: from, requestedState: to, state: to, changed: from !== to, blockedByTerminalState: false };
        const flaggedAsTransition = lifecycleResolutionProblems(forged).some((p) => /not an allowed transition/.test(p));
        expect(flaggedAsTransition).toBe(forged.changed && !isTransitionAllowed(from, to));
      });
    });
  });

  it('flags resolutions that could not have happened', () => {
    const base = resolveNextState('WATCH', classified('SETUP'));
    expect(lifecycleResolutionProblems({ ...base, changed: false }).join()).toMatch(/changed does not match/);
    expect(lifecycleResolutionProblems({ ...base, state: 'ACTIONABLE', changed: true }).join()).toMatch(/without being blocked/);
    expect(lifecycleResolutionProblems({ ...base, blockedByTerminalState: true }).join()).toMatch(/previousState is not terminal/);

    const blocked = resolveNextState('EXPIRED', classified('SETUP'));
    expect(lifecycleResolutionProblems({ ...blocked, blockedByTerminalState: false }).join()).toMatch(/must be marked blocked/);
    expect(lifecycleResolutionProblems({ ...blocked, state: 'SETUP', changed: true }).join()).toMatch(/persisted state moved/);

    const blind = resolveNextState('WATCH', insufficientData(['pe']));
    expect(lifecycleResolutionProblems({ ...blind, state: 'SETUP', changed: true }).join()).toMatch(/INSUFFICIENT_DATA evaluation must not change/);
  });
});
