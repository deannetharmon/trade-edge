// lib/scans/__tests__/csp-finder-multicandidate.test.ts
// CSP-WORKFLOW-0001 — required acceptance fixtures at the findAllCsp()
// layer: the NKE two-put fixture (proving multi-candidate discovery per
// symbol) and the capital/account-eligibility fixtures (proving market
// qualification and account eligibility are independent axes, capital is
// evaluated per-candidate, and there is no $100,000 or "unlimited" fallback
// anywhere in the capital path).
import { describe, it, expect } from 'vitest';
import { findAllCsp } from '../csp-finder';
import { DEFAULT_CSP_RULES } from '../constants';

function futureExpiration(daysOut = 35): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

// The exact NKE fixture required by the ticket: two puts on the same
// underlying/expiration, both structurally valid and inside the DTE/delta
// window, that must both survive discovery as distinct candidates.
function nkeChain() {
  const exp = futureExpiration();
  return {
    expirations: [exp],
    chains: {
      [exp]: [
        { strikePrice: 39, expirationDate: exp, optionType: 'P' as const, delta: -0.24, bid: 0.66, ask: 0.73, mid: 0.695, openInterest: 78, occSymbol: 'NKE_39P_OCC' },
        { strikePrice: 38, expirationDate: exp, optionType: 'P' as const, delta: -0.17, bid: 0.44, ask: 0.50, mid: 0.47, openInterest: 628, occSymbol: 'NKE_38P_OCC' },
      ],
    },
  };
}

const NKE_PRICE = 78.50;

describe('findAllCsp — NKE required acceptance fixture (multi-candidate)', () => {
  it('preserves both the 39 and 38 puts as distinct candidates -- neither is silently dropped', () => {
    const result = findAllCsp(nkeChain(), NKE_PRICE, { rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'NKE' });
    expect(result.results.length).toBe(2);
    const strikes = result.results.map(r => r.candidate.shortStrike).sort((a, b) => a - b);
    expect(strikes).toEqual([38, 39]);
  });

  it('each candidate gets its own stable, distinct candidateId -- composite fallback, since this fixture\'s occSymbol values ("NKE_39P_OCC" etc.) are synthetic test labels, not real OCC symbols, and the canonical parser correctly declines to treat them as primary identity', () => {
    const chain = nkeChain();
    const exp = chain.expirations[0];
    const result = findAllCsp(chain, NKE_PRICE, { rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'NKE' });
    const ids = result.results.map(r => r.candidateId);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(expect.arrayContaining([
      `composite:CSP:NKE:${exp}:P:39`,
      `composite:CSP:NKE:${exp}:P:38`,
    ]));
  });

  it('the 39 put (OI 78, below the 500 minimum) carries its own advisory OI warning independent of the 38 put (OI 628, no warning)', () => {
    const result = findAllCsp(nkeChain(), NKE_PRICE, { rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'NKE' });
    const put39 = result.results.find(r => r.candidate.shortStrike === 39)!;
    const put38 = result.results.find(r => r.candidate.shortStrike === 38)!;
    expect(put39.advisoryWarnings.some(w => /OI 78 is below the preferred minimum of 500/.test(w))).toBe(true);
    expect(put38.advisoryWarnings.some(w => /below the preferred minimum/.test(w))).toBe(false);
  });

  it('both candidates score independently (own credit/ROC/POP), proving no collapse to one contract', () => {
    const result = findAllCsp(nkeChain(), NKE_PRICE, { rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'NKE' });
    const put39 = result.results.find(r => r.candidate.shortStrike === 39)!;
    const put38 = result.results.find(r => r.candidate.shortStrike === 38)!;
    expect(put39.candidate.credit).not.toBe(put38.candidate.credit);
    expect(put39.candidate.pop).not.toBe(put38.candidate.pop);
  });
});

// ── Capital fixtures ────────────────────────────────────────────────────
function singleStrikeChain(strike: number, delta: number, bid: number, ask: number) {
  const exp = futureExpiration();
  return {
    expirations: [exp],
    chains: {
      [exp]: [
        { strikePrice: strike, expirationDate: exp, optionType: 'P' as const, delta: -delta, bid, ask, mid: (bid + ask) / 2, openInterest: 1000, occSymbol: `CAP_${strike}P_OCC` },
      ],
    },
  };
}

describe('findAllCsp — required capital fixtures', () => {
  it('a closer-delta contract that is unaffordable and a farther contract that IS affordable both remain visible; only the affordable one is account-ELIGIBLE', () => {
    const exp = futureExpiration();
    const chain = {
      expirations: [exp],
      chains: {
        [exp]: [
          // Closer to center delta (0.20), expensive strike -- unaffordable.
          { strikePrice: 400, expirationDate: exp, optionType: 'P' as const, delta: -0.20, bid: 8.00, ask: 8.20, mid: 8.10, openInterest: 1000, occSymbol: 'EXPENSIVE_OCC' },
          // Farther from center (0.16), cheap strike -- affordable.
          { strikePrice: 50, expirationDate: exp, optionType: 'P' as const, delta: -0.16, bid: 1.00, ask: 1.10, mid: 1.05, openInterest: 1000, occSymbol: 'CHEAP_OCC' },
        ],
      },
    };
    const result = findAllCsp(chain, 410, {
      rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'TEST',
      capital: { accountSelected: true, accountId: 'acct-1', optionBuyingPower: 6000, cashBalance: 6000 },
    });
    expect(result.results.length).toBe(2);
    const expensive = result.results.find(r => r.candidate.shortStrike === 400)!;
    const cheap = result.results.find(r => r.candidate.shortStrike === 50)!;
    // Both remain visible as real market candidates.
    expect(expensive.candidate).toBeDefined();
    expect(cheap.candidate).toBeDefined();
    // Required cash: 400*100=$40,000 (unaffordable at $6,000) vs 50*100=$5,000 (affordable).
    expect(expensive.accountEligibility).toBe('INSUFFICIENT_CAPITAL');
    expect(cheap.accountEligibility).toBe('ELIGIBLE');
    // Market qualification is untouched by account state -- both are market-qualified.
    expect(expensive.marketQualification).toBe('QUALIFIED');
    expect(cheap.marketQualification).toBe('QUALIFIED');
  });

  it('a capital lookup failure (missing/non-finite buying power or cash) produces CAPITAL_UNVERIFIED, never ELIGIBLE and never a $100,000 fallback', () => {
    const result = findAllCsp(singleStrikeChain(50, 0.20, 1.00, 1.10), 55, {
      rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'TEST',
      capital: { accountSelected: true, accountId: 'acct-1', optionBuyingPower: null, cashBalance: 9000 },
    });
    const r = result.results[0];
    expect(r.accountEligibility).toBe('CAPITAL_UNVERIFIED');
    expect(r.candidate.cspAvailableCapital).toBeNull();
  });

  it('no account selected produces the distinct ACCOUNT_UNSELECTED state -- never ELIGIBLE, and never conflated with a verified-but-insufficient capital figure -- even when buying power/cash figures are present', () => {
    const result = findAllCsp(singleStrikeChain(50, 0.20, 1.00, 1.10), 55, {
      rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'TEST',
      capital: { accountSelected: false, optionBuyingPower: 50000, cashBalance: 50000 },
    });
    const r = result.results[0];
    expect(r.accountEligibility).toBe('ACCOUNT_UNSELECTED');
    expect(r.accountEligibility).not.toBe('ELIGIBLE');
  });

  it('available CSP capital is min(optionBuyingPower, cashBalance) for the selected account -- never net liq, stock BP, or any other substitute', () => {
    const result = findAllCsp(singleStrikeChain(50, 0.20, 1.00, 1.10), 55, {
      rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'TEST',
      capital: { accountSelected: true, accountId: 'acct-1', optionBuyingPower: 12000, cashBalance: 4800 },
    });
    // min(12000, 4800) = 4800; required cash for the 50-strike single
    // contract is 50*100 = 5000, which EXCEEDS 4800 -- insufficient.
    expect(result.results[0].candidate.cspAvailableCapital).toBe(4800);
    expect(result.results[0].accountEligibility).toBe('INSUFFICIENT_CAPITAL');
  });

  it('quantity (contracts) > 1 scales required cash correctly without altering the per-share/per-contract math', () => {
    const result = findAllCsp(singleStrikeChain(50, 0.20, 1.00, 1.10), 55, {
      rules: DEFAULT_CSP_RULES, contracts: 3, underlyingSymbol: 'TEST',
      capital: { accountSelected: true, accountId: 'acct-1', optionBuyingPower: 20000, cashBalance: 20000 },
    });
    const c = result.results[0].candidate;
    expect(c.requiredCash).toBe(50 * 100 * 3); // 15,000 -- not per-share, not per-contract-only
    expect(c.credit).toBeCloseTo(1.05 * 100 * 3, 2); // total premium across 3 contracts
    expect(result.results[0].accountEligibility).toBe('ELIGIBLE'); // 15,000 <= 20,000 available
  });

  it('a negative or non-finite buying power/cash figure is treated as unverified, never as zero-but-still-a-number capital', () => {
    const result = findAllCsp(singleStrikeChain(50, 0.20, 1.00, 1.10), 55, {
      rules: DEFAULT_CSP_RULES, contracts: 1, underlyingSymbol: 'TEST',
      capital: { accountSelected: true, accountId: 'acct-1', optionBuyingPower: -500, cashBalance: 9000 },
    });
    expect(result.results[0].accountEligibility).toBe('CAPITAL_UNVERIFIED');
    expect(result.results[0].candidate.cspAvailableCapital).toBeNull();
  });
});
