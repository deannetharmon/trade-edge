import { describe, expect, it } from 'vitest';
import { evaluateProfitProtectingStop } from '../profitProtectingStop';

const evaluate = (overrides: Partial<Parameters<typeof evaluateProfitProtectingStop>[0]> = {}) =>
  evaluateProfitProtectingStop({ creditPerContract: 2, marketableClosePerContract: 0.8, currentStopTrigger: 4, hasWorkingStop: true, quoteQuality: 'RELIABLE', ...overrides });

describe('evaluateProfitProtectingStop', () => {
  it.each([
    [1, 'BREAK_EVEN_50', 0, 'breaks even'],
    [0.7, 'LOCK_25_65', 25, 'locks 25% of original credit'],
    [0.5, 'LOCK_50_75', 50, 'locks 50% of original credit'],
  ] as const)('maps the approved stage to its stop and P/L meaning', (close, stage, protectedPnlPct, label) => {
    const proposal = evaluate({ marketableClosePerContract: close });
    expect(proposal.status).toBe('TIGHTEN_AVAILABLE');
    expect(proposal.stage).toBe(stage);
    expect(proposal.proposedStopTrigger).toBe(close === 1 ? 2 : close === 0.7 ? 1.5 : 1);
    expect(proposal.protectedPnlPct).toBe(protectedPnlPct);
    expect(proposal.protectedPnlLabel).toBe(label);
  });

  it('never proposes a widening adjustment', () => {
    const proposal = evaluate({ marketableClosePerContract: 0.5, currentStopTrigger: 0.9 });
    expect(proposal.status).toBe('ALREADY_PROTECTED');
  });

  it('requires reliable marketable quote evidence', () => {
    expect(evaluate({ quoteQuality: 'DEGRADED' }).status).toBe('UNAVAILABLE');
  });
});
