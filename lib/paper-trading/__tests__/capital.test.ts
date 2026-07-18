// lib/paper-trading/__tests__/capital.test.ts

import { describe, expect, it } from 'vitest';
import { computeCapitalRequirement, requireSufficientCapital } from '../capital';
import { PaperTradingError } from '../types';
import type { PaperLeg } from '../types';

const EXP = '2026-08-21';

describe('computeCapitalRequirement', () => {
  it('CSP: reserved capital is the full cash-secured obligation (strike x multiplier x quantity), independent of credit', () => {
    const legs: PaperLeg[] = [{ legId: 'p', optionType: 'put', strike: 500, expiration: EXP, openAction: 'sell_to_open' }];
    const { reservedCapital, theoreticalMaxLoss } = computeCapitalRequirement('CSP', legs, 2, 100, 300);
    expect(reservedCapital).toBe(500 * 100 * 2);
    expect(theoreticalMaxLoss).toBe(500 * 100 * 2 - 300);
  });

  it('BPS: max loss is width x multiplier x quantity minus credit; reserved capital equals max loss', () => {
    const legs: PaperLeg[] = [
      { legId: 'short', optionType: 'put', strike: 500, expiration: EXP, openAction: 'sell_to_open' },
      { legId: 'long', optionType: 'put', strike: 490, expiration: EXP, openAction: 'buy_to_open' },
    ];
    const { reservedCapital, theoreticalMaxLoss } = computeCapitalRequirement('BPS', legs, 1, 100, 150);
    const expected = 10 * 100 - 150;
    expect(theoreticalMaxLoss).toBe(expected);
    expect(reservedCapital).toBe(expected);
  });

  it('BCS: max loss is width x multiplier x quantity minus credit', () => {
    const legs: PaperLeg[] = [
      { legId: 'short', optionType: 'call', strike: 520, expiration: EXP, openAction: 'sell_to_open' },
      { legId: 'long', optionType: 'call', strike: 530, expiration: EXP, openAction: 'buy_to_open' },
    ];
    const { reservedCapital, theoreticalMaxLoss } = computeCapitalRequirement('BCS', legs, 1, 100, 200);
    const expected = 10 * 100 - 200;
    expect(theoreticalMaxLoss).toBe(expected);
    expect(reservedCapital).toBe(expected);
  });

  it('IC: max loss uses the larger wing width only, never the sum of both wings', () => {
    const legs: PaperLeg[] = [
      { legId: 'short-put', optionType: 'put', strike: 490, expiration: EXP, openAction: 'sell_to_open' },
      { legId: 'long-put', optionType: 'put', strike: 480, expiration: EXP, openAction: 'buy_to_open' }, // width 10
      { legId: 'short-call', optionType: 'call', strike: 520, expiration: EXP, openAction: 'sell_to_open' },
      { legId: 'long-call', optionType: 'call', strike: 535, expiration: EXP, openAction: 'buy_to_open' }, // width 15
    ];
    const { reservedCapital, theoreticalMaxLoss } = computeCapitalRequirement('IC', legs, 1, 100, 300);
    // larger width (15) x 100 - credit, NOT (10+15)*100 - credit
    const expected = 15 * 100 - 300;
    expect(theoreticalMaxLoss).toBe(expected);
    expect(reservedCapital).toBe(expected);
  });

  it('never returns a negative max loss even if credit exceeds gross risk', () => {
    const legs: PaperLeg[] = [
      { legId: 'short', optionType: 'put', strike: 500, expiration: EXP, openAction: 'sell_to_open' },
      { legId: 'long', optionType: 'put', strike: 495, expiration: EXP, openAction: 'buy_to_open' },
    ];
    const { theoreticalMaxLoss } = computeCapitalRequirement('BPS', legs, 1, 100, 10_000);
    expect(theoreticalMaxLoss).toBe(0);
  });
});

describe('requireSufficientCapital', () => {
  it('passes when reserved capital is within available capital', () => {
    expect(() => requireSufficientCapital(1000, 500)).not.toThrow();
  });

  it('rejects when reserved capital exceeds available capital', () => {
    expect(() => requireSufficientCapital(400, 500)).toThrow(PaperTradingError);
  });
});
