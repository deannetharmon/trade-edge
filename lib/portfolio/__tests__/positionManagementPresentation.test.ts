import { describe, expect, it } from 'vitest';
import {
  creditClosePnlDollars,
  protectiveStopOutcomeLabel,
  signedDollar,
} from '../positionManagementPresentation';

describe('position management presentation economics', () => {
  it('shows a profitable protective stop as profit, not loss', () => {
    const pnl = creditClosePnlDollars(8.05, 7.55, 1);
    expect(pnl).toBe(50);
    expect(signedDollar(pnl)).toBe('+$50.00');
    expect(protectiveStopOutcomeLabel(pnl)).toBe('protected profit +$50.00');
  });

  it('shows a stop above entry credit as a loss', () => {
    const pnl = creditClosePnlDollars(8.05, 9.55, 1);
    expect(pnl).toBe(-150);
    expect(protectiveStopOutcomeLabel(pnl)).toBe('loss -$150.00');
  });

  it('scales signed economics by quantity', () => {
    expect(creditClosePnlDollars(2, 1.5, 3)).toBe(150);
    expect(signedDollar(-150)).toBe('-$150.00');
  });

  it('does not emit negative zero', () => {
    expect(signedDollar(-0)).toBe('+$0.00');
  });
});
