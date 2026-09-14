import { describe, it, expect } from 'vitest';
import { assessOiLiquidity } from '../oiLiquidity';

describe('assessOiLiquidity', () => {
  it('passes when short leg OI meets the floor', () => {
    const result = assessOiLiquidity({ shortOI: 500, longOI: 911, oiMin: 500 });
    expect(result.status).toBe('pass');
    expect(result.reason).toContain('≥ 500');
  });

  it('passes comfortably above the floor', () => {
    const result = assessOiLiquidity({ shortOI: 2000, longOI: 3000, oiMin: 500 });
    expect(result.status).toBe('pass');
  });

  // OI-LIQUIDITY-CHOICE-0001: never a hard fail, no matter how low --
  // this is the whole point of the ticket. Status must be 'warn', not
  // 'fail', at every below-floor value.
  it('warns, never fails, just below the floor', () => {
    const result = assessOiLiquidity({ shortOI: 499, longOI: 911, oiMin: 500 });
    expect(result.status).toBe('warn');
  });

  it('warns, never fails, at Dean\u2019s actual SOXL example (202 OI, 500 floor)', () => {
    const result = assessOiLiquidity({ shortOI: 202, longOI: 911, oiMin: 500 });
    expect(result.status).toBe('warn');
    expect(result.reason).toContain('202');
    expect(result.reason).toContain('500');
  });

  it('warns, never fails, at zero OI', () => {
    const result = assessOiLiquidity({ shortOI: 0, longOI: 911, oiMin: 500 });
    expect(result.status).toBe('warn');
  });

  it('the reason states the actual numbers, not a generic warning (Ian\u2019s bar)', () => {
    const result = assessOiLiquidity({ shortOI: 202, longOI: 911, oiMin: 500 });
    // Must be the real disclosed numbers, not a vague "liquidity is thin"
    expect(result.reason).toMatch(/202/);
    expect(result.reason).toMatch(/500/);
  });

  it('value always shows both legs\u2019 OI regardless of pass/warn', () => {
    const passing = assessOiLiquidity({ shortOI: 600, longOI: 700, oiMin: 500 });
    const warning = assessOiLiquidity({ shortOI: 100, longOI: 700, oiMin: 500 });
    expect(passing.value).toBe('600/700');
    expect(warning.value).toBe('100/700');
  });

  it('gates on the SHORT leg specifically, not the long leg', () => {
    // High long OI does not rescue a thin short leg -- the short leg is
    // the one carrying assignment risk and driving fill difficulty.
    const result = assessOiLiquidity({ shortOI: 50, longOI: 5000, oiMin: 500 });
    expect(result.status).toBe('warn');
  });
});
