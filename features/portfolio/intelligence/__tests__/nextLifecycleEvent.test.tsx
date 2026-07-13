// features/portfolio/intelligence/__tests__/nextLifecycleEvent.test.tsx
//
// PI-0005: pure-logic coverage for Next Expected Lifecycle Event.

import { describe, expect, it } from 'vitest';
import { deriveNextLifecycleEvent } from '../nextLifecycleEvent';

describe('PI-0005: deriveNextLifecycleEvent', () => {
  it('always returns the covered-call-candidate phrase for assigned stock, regardless of kind', () => {
    expect(deriveNextLifecycleEvent('ASSIGNED_STOCK', 'hold')).toBe('Covered call candidate after assignment.');
    expect(deriveNextLifecycleEvent('ASSIGNED_STOCK', 'watch')).toBe('Covered call candidate after assignment.');
  });

  it('returns "Prepare for assignment." for assignment-risk on a non-assigned lifecycle', () => {
    expect(deriveNextLifecycleEvent('CSP', 'assignment-risk')).toBe('Prepare for assignment.');
  });

  it('returns "Harvest likely next." for close-winner', () => {
    expect(deriveNextLifecycleEvent('SPREAD', 'close-winner')).toBe('Harvest likely next.');
  });

  it('returns "Earnings review approaching." for earnings-risk', () => {
    expect(deriveNextLifecycleEvent('SPREAD', 'earnings-risk')).toBe('Earnings review approaching.');
  });

  it('returns "Continue monitoring." for hold and watch on non-assigned lifecycles', () => {
    expect(deriveNextLifecycleEvent('CSP', 'hold')).toBe('Continue monitoring.');
    expect(deriveNextLifecycleEvent('SPREAD', 'watch')).toBe('Continue monitoring.');
  });
});
