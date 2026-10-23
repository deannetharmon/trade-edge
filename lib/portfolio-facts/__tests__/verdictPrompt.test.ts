// lib/portfolio-facts/__tests__/verdictPrompt.test.ts

import { describe, expect, it } from 'vitest';
import { buildVerdictPromptBlock } from '../verdictPrompt';
import type { PositionFacts } from '../positionFacts';
import type { Verdict } from '../verdict';

const complete = { identity: true, economics: true, time: true, greeks: true, volatility: true, technicals: true, events: true, risk: true, orders: true };
const facts = (over: Partial<PositionFacts['complete']> = {}) => ({ complete: { ...complete, ...over } } as PositionFacts);
const verdict: Verdict = {
  snapshotId: 's', positionKey: 'k', intent: 'TAKE_PROFIT', label: 'Take Profit', bucket: 'Close', hardRule: null, legacyKind: 'close-winner', quietConfirmation: false,
  reasons: [{ ruleId: 'profit-target-reached', text: 'Profit target reached.', dataPoint: 'profitTargetReached', value: 50, points: 60 }],
  confidence: { level: 'HIGH', basis: ['engine margin: High'] },
};

describe('buildVerdictPromptBlock', () => {
  it('states the official verdict, its reasons with data points, and the disagree-openly rule', () => {
    const text = buildVerdictPromptBlock(verdict, facts());
    expect(text).toContain('Close — Take Profit');
    expect(text).toContain('profit-target-reached: Profit target reached. [profitTargetReached = 50]');
    expect(text).toContain('All fact groups are complete.');
    expect(text).toContain('name the data point');
  });
  it('lists the groups the rules could not see', () => {
    const text = buildVerdictPromptBlock(verdict, facts({ technicals: false, volatility: false }));
    expect(text).toContain('Data not available to the rules: volatility (IV, IVR, HV); technicals (RSI, trend)');
  });
  it('says so when there is no verdict, and names a hard rule when one fired', () => {
    expect(buildVerdictPromptBlock(null, facts())).toContain('No position verdict is available');
    expect(buildVerdictPromptBlock({ ...verdict, bucket: 'Roll', intent: 'HOLD_POSITION', label: 'roll-soon', hardRule: { kind: 'roll-soon', label: 'roll-soon' } }, facts())).toContain('hard rule: roll-soon');
  });
});

describe('buildVerdictPromptBlock options', () => {
  it('the label on screen wins over a recomputed one', () => {
    const text = buildVerdictPromptBlock(verdict, facts(), { onScreenLabel: 'Roll Soon' });
    expect(text).toContain('Close — Roll Soon');
    expect(text).not.toContain('Close — Take Profit');
  });
  it('groups the caller did not supply are not reported as unavailable', () => {
    const text = buildVerdictPromptBlock(verdict, facts({ technicals: false, risk: false, volatility: false }), { notSupplied: ['technicals', 'risk'] });
    expect(text).toContain('Data not available to the rules: volatility (IV, IVR, HV).');
    expect(text).not.toContain('technicals');
  });
});
