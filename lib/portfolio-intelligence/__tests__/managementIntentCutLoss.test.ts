// lib/portfolio-intelligence/__tests__/managementIntentCutLoss.test.ts

import { describe, expect, it } from 'vitest';
import { selectManagementIntent } from '../managementIntent';

describe('MGMT-INTENT-CUTLOSS-0001: Cut Losses must be earned by a visible, loss-driven signal', () => {
  it('a hidden Net Edge nudge alone never produces Cut Losses', () => {
    const r = selectManagementIntent({ context: 'credit-spread', netEdgeNegative: true });
    expect(r.intent).not.toBe('CUT_LOSSES');
  });
  it('a profitable position is never told to cut losses, even with technicals against it', () => {
    const r = selectManagementIntent({ context: 'credit-spread', technicalAlignment: 'against', netEdgeNegative: true, pnlPct: 20 });
    expect(r.intent).not.toBe('CUT_LOSSES');
  });
  it('a real, visible loss signal still wins', () => {
    const r = selectManagementIntent({ context: 'credit-spread', technicalAlignment: 'against', pnlPct: -40, materialLoss: true });
    expect(r.intent).toBe('CUT_LOSSES');
  });
});
