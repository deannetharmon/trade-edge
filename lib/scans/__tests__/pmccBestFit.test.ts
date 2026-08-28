import { describe, expect, it } from 'vitest';
import { computePmccBestFit, describePmccBestFitComparison } from '../pmccBestFit';

const base = { shortDte: 28, underlyingPrice: 78.52, shortSpreadPct: 4, shortOpenInterest: 800 };

describe('computePmccBestFit', () => {
  it('prefers the more OTM, lower-delta UBER-like call in Balanced and Upside modes', () => {
    const eighty = { ...base, shortDelta: 0.44, shortStrike: 80, shortCredit: 2.19 };
    const seventyNine = { ...base, shortDelta: 0.49, shortStrike: 79, shortCredit: 2.65 };
    expect(computePmccBestFit('balanced', eighty)).toBeGreaterThan(computePmccBestFit('balanced', seventyNine));
    expect(computePmccBestFit('upside', eighty)).toBeGreaterThan(computePmccBestFit('upside', seventyNine));
  });

  it('can prefer a higher-credit candidate in Income mode when execution is comparable', () => {
    const conservative = { ...base, shortDelta: 0.30, shortStrike: 82, shortCredit: 1.20 };
    const income = { ...base, shortDelta: 0.36, shortStrike: 80, shortCredit: 3.00 };
    expect(computePmccBestFit('income', income)).toBeGreaterThan(computePmccBestFit('income', conservative));
  });

  it('does not let a materially poorer executable quote win Income mode purely on premium', () => {
    const executable = { ...base, shortDelta: 0.35, shortStrike: 80, shortCredit: 1.20, shortSpreadPct: 1, shortOpenInterest: 2_000 };
    const theoreticalPremium = { ...base, shortDelta: 0.35, shortStrike: 80, shortCredit: 8.00, shortSpreadPct: 10, shortOpenInterest: 0 };

    expect(computePmccBestFit('income', executable)).toBeGreaterThan(computePmccBestFit('income', theoreticalPremium));
  });

  it('states concrete, truthful winner-versus-runner-up tradeoffs', () => {
    const text = describePmccBestFitComparison('balanced',
      { ...base, shortDelta: 0.30, shortStrike: 82, shortCredit: 1.54, shortSpreadPct: 2.0, shortOpenInterest: 900 },
      { ...base, shortDelta: 0.35, shortStrike: 81, shortCredit: 2.00, shortSpreadPct: 3.3, shortOpenInterest: 500 },
    );
    expect(text).toContain('$0.46 less credit');
    expect(text).toContain('0.05 closer to target delta');
    expect(text).toContain('1.3% farther OTM');
    expect(text).toContain('1.3% tighter spread');
  });

  it('omits equal or unavailable comparison metrics', () => {
    const text = describePmccBestFitComparison('income',
      { ...base, shortDelta: 0.35, shortStrike: 80, shortCredit: 2, shortSpreadPct: null, shortOpenInterest: null },
      { ...base, shortDelta: 0.35, shortStrike: 80, shortCredit: 2, shortSpreadPct: null, shortOpenInterest: null },
    );
    expect(text).toBeNull();
  });

  it('does not emit an empty but-clause when truncation hides all advantages', () => {
    const text = describePmccBestFitComparison('balanced',
      { shortDelta: 0.55, shortDte: 45, shortStrike: 79, underlyingPrice: 78.52, shortCredit: 1, shortSpreadPct: 9, shortOpenInterest: 0 },
      { shortDelta: 0.30, shortDte: 32, shortStrike: 84, underlyingPrice: 78.52, shortCredit: 3, shortSpreadPct: 1, shortOpenInterest: 1_000 },
    );
    expect(text).not.toContain(', but .');
    expect(text).not.toContain(', but');
  });
});
