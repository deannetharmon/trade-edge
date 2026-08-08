// lib/scans/__tests__/csp-finder.test.ts
//
// CSP-0002 Layer 2 — one authoritative AMD fixture, reproducing the exact
// production incident: TradeEdge scanned AMD and reported "No qualifying
// put found in delta 0.15-0.25 / DTE 30-45 window" even though a live
// Tastytrade chain had five puts inside that window. This proves
// findBestCsp() (the full lib/scans layer, one level above the pure search
// module already covered in cspSearch.test.ts) now surfaces a real,
// deterministic candidate instead of null, with truthful liquidity
// diagnostics, using the exact strikes/deltas/OI/bid/ask from the incident
// report.
import { describe, it, expect } from 'vitest';
import { findBestCsp } from '../csp-finder';
import { DEFAULT_CSP_RULES } from '../constants';

const AMD_UNDERLYING_PRICE = 477.85;

function amdExpDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 35);
  return d.toISOString().slice(0, 10);
}

// The exact chain from the incident report. Raw deltas are negative (as a
// real put chain always reports them) -- normalization to abs() happens
// inside the search, not in this fixture.
function amdChain() {
  const exp = amdExpDate();
  const legs = [
    // CSP-WORKFLOW-0001 core-correction (BLOCKER-05) — the approved AMD
    // acceptance fixture is six strikes, not five; 405 was missing. Real
    // bid/ask/OI values (not adjusted to force any particular
    // classification): 405's $0.70 width on a $7.25 mid (~9.7%) happens to
    // land STRONG under the relative liquidity policy, distinct from
    // 410/415's POOR and 420/425/430's BORDERLINE.
    { strike: 405, delta: -0.16, oi: 245, bid: 6.90, ask: 7.60 },
    { strike: 410, delta: -0.18, oi: 167, bid: 9.00, ask: 10.65 },
    { strike: 415, delta: -0.20, oi: 190, bid: 10.20, ask: 11.90 },
    { strike: 420, delta: -0.22, oi: 409, bid: 11.45, ask: 13.20 },
    { strike: 425, delta: -0.24, oi: 107, bid: 12.85, ask: 14.60 },
    { strike: 430, delta: -0.25, oi: 333, bid: 14.00, ask: 16.20 },
  ];
  return {
    expirations: [exp],
    chains: {
      [exp]: legs.map((l, i) => ({
        strikePrice: l.strike, expirationDate: exp, optionType: 'P' as const,
        delta: l.delta, bid: l.bid, ask: l.ask, mid: (l.bid + l.ask) / 2,
        openInterest: l.oi, occSymbol: `AMD_${exp}_P${l.strike}_${i}`,
      })),
    },
  };
}

describe('findBestCsp — AMD production-incident fixture', () => {
  it('discovers a real candidate instead of returning null (the core bug)', () => {
    const result = findBestCsp(amdChain(), AMD_UNDERLYING_PRICE, { rules: DEFAULT_CSP_RULES, contracts: 1 });
    expect(result.candidate).not.toBeNull();
    expect(result.search.reason).toBeNull();
    // The old bug's exact symptom must never recur.
    expect(result.search.reason).not.toBe('NO_PUT_IN_DELTA_WINDOW');
  });

  it('every put in the chain is inside the DTE/delta window, proving this is a liquidity story, not a discovery story', () => {
    const result = findBestCsp(amdChain(), AMD_UNDERLYING_PRICE, { rules: DEFAULT_CSP_RULES, contracts: 1 });
    expect(result.search.diagnostics.expirationsInDteWindow).toBe(1);
    // CSP-WORKFLOW-0001 core-correction (BLOCKER-05) — six strikes now,
    // 405 through 430.
    expect(result.search.diagnostics.putsInDeltaWindow).toBe(6);
    expect(result.search.diagnostics.validQuoteCandidates).toBe(6);
    // None of the 6 clears OI>=500 -- every strike carries a low-OI
    // advisory warning, which is the true, honest state of this chain.
    expect(result.search.diagnostics.oiPassingCandidates).toBe(0);
    // CSP-WORKFLOW-0001 — updated from the old flat-$0.10-rule expectation
    // (which asserted 0 of 5 passed liquidity). Under the approved relative
    // liquidity policy (strongLimit = max($0.10, 10% of mid); borderline up
    // to 15% of mid), 420/425/430 (proportionally tight markets on a
    // $12-15 mid) classify BORDERLINE and 405 (a $0.70 width on a $7.25
    // mid, ~9.7%) classifies STRONG -- 4 of the 6 AMD strikes now pass
    // liquidity, rather than uniformly POOR -- exactly the liquidity-policy
    // defect documented in
    // docs/reviews/FIND-CSP-Comprehensive-Code-Audit.md §8, which the flat
    // rule could never recognize. This is the intended, approved behavior
    // change, not a regression.
    expect(result.search.diagnostics.spreadPassingCandidates).toBe(4);
  });

  it('the raw negative put delta is normalized and displayed as a positive absolute value', () => {
    const result = findBestCsp(amdChain(), AMD_UNDERLYING_PRICE, { rules: DEFAULT_CSP_RULES, contracts: 1 });
    expect(result.candidate!.shortDelta).toBeGreaterThan(0);
  });

  it('CSP-WORKFLOW-0001: under the relative liquidity policy the selected (420) candidate is QUALIFIED_WITH_LIQUIDITY_WARNING -- market-qualified with a low-OI warning, not disqualified', () => {
    // Superseding the old expectation that this candidate was flatly
    // disqualified: 420's $1.75 width on a $12.325 mid (~14.2%) is
    // proportionally tight enough to be BORDERLINE, not POOR, under the
    // approved relative policy -- see the diagnostics test above. It is
    // still capital-unverified (no capital params were supplied), so the
    // legacy `qualified` boolean is not blocked by that either.
    const result = findBestCsp(amdChain(), AMD_UNDERLYING_PRICE, { rules: DEFAULT_CSP_RULES, contracts: 1 });
    expect(result.candidate!.shortStrike).toBe(420);
    expect(result.candidate!.cspMarketQualification).toBe('QUALIFIED_WITH_LIQUIDITY_WARNING');
    expect(result.qualified).toBe(true);
    // A warned-but-qualified candidate carries no disqualification reason at
    // all -- the old generic message is not merely absent, it is null.
    expect(result.disqualificationReason).toBeNull();
    expect(result.candidate!.cspAdvisoryWarnings ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/OI 409 is below the preferred minimum of 500/)]),
    );
  });

  it('candidate fundamentals are computed with the documented production formulas', () => {
    const result = findBestCsp(amdChain(), AMD_UNDERLYING_PRICE, { rules: DEFAULT_CSP_RULES, contracts: 1 });
    const c = result.candidate!;
    // Selection: among the 5, the deterministic winner is whichever ranks
    // best under "closest to center (0.20), then narrower width, then
    // higher OI" once none are ELIGIBLE -- assert against the search's own
    // selection rather than hardcoding a strike, so this test tracks the
    // production ranking function instead of re-deriving it.
    expect(['405', '410', '415', '420', '425', '430']).toContain(String(c.shortStrike));

    const mid = (c.shortBid! + c.shortAsk!) / 2;
    expect(c.credit).toBeCloseTo(parseFloat((mid * 100).toFixed(2)), 2); // Premium/contract = credit/share x 100
    expect(c.requiredCash).toBeCloseTo(c.shortStrike * 100, 2);          // Cash required = strike x 100 x contracts
    expect(c.breakeven).toBeCloseTo(parseFloat((c.shortStrike - mid).toFixed(2)), 2); // Breakeven = strike - credit/share
    expect(c.pop).toBeCloseTo((1 - c.shortDelta) * 100, 5);              // Estimated POP = (1 - |delta|) x 100
  });

  it('a wide-market-only or low-OI-only slice of the same chain still finds a candidate, with the correct single-cause status', () => {
    const exp = amdExpDate();
    const wideOnly = {
      expirations: [exp],
      chains: { [exp]: [{ strikePrice: 415, expirationDate: exp, optionType: 'P' as const, delta: -0.20, bid: 10.20, ask: 11.90, mid: 11.05, openInterest: 1000, occSymbol: 'WIDE' }] },
    };
    const lowOiOnly = {
      expirations: [exp],
      chains: { [exp]: [{ strikePrice: 415, expirationDate: exp, optionType: 'P' as const, delta: -0.20, bid: 10.95, ask: 11.05, mid: 11.00, openInterest: 190, occSymbol: 'LOWOI' }] },
    };
    const wideResult = findBestCsp(wideOnly, AMD_UNDERLYING_PRICE, { rules: DEFAULT_CSP_RULES, contracts: 1 });
    expect(wideResult.search.selectedStatus).toBe('DISQUALIFIED_WIDE_MARKET');
    expect(wideResult.qualified).toBe(false);

    const lowOiResult = findBestCsp(lowOiOnly, AMD_UNDERLYING_PRICE, { rules: DEFAULT_CSP_RULES, contracts: 1 });
    expect(lowOiResult.search.selectedStatus).toBe('QUALIFIED_LOW_OI');
    // Open-interest policy: low OI alone never disqualifies.
    expect(lowOiResult.qualified).toBe(true);
    // CSP-0002 corrective pass — the warning must state the actual observed
    // OI and the actual configured minimum, not a generic message.
    expect(lowOiResult.candidate!.cspOiWarning).toBe('OI 190 is below the preferred minimum of 500.');
  });
});

describe('findBestCsp — CSP-0002 corrective pass BLOCKER regression: selection agrees with qualification', () => {
  it('selects the narrow-market, low-OI candidate as QUALIFIED (with an OI warning) over a closer-delta, wide-market, sufficient-OI candidate', () => {
    const exp = amdExpDate();
    const chain = {
      expirations: [exp],
      chains: {
        [exp]: [
          // Candidate A: closest to delta center (0.20), sufficient OI,
          // wide market -- must be disqualified and NOT selected.
          { strikePrice: 415, expirationDate: exp, optionType: 'P' as const, delta: -0.20, bid: 10.20, ask: 11.90, mid: 11.05, openInterest: 1000, occSymbol: 'A_WIDE_GOODOI' },
          // Candidate B: farther from center (0.15), low OI, narrow market
          // -- must be the selection: qualified, with an OI warning.
          { strikePrice: 410, expirationDate: exp, optionType: 'P' as const, delta: -0.15, bid: 8.95, ask: 9.05, mid: 9.00, openInterest: 190, occSymbol: 'B_NARROW_LOWOI' },
        ],
      },
    };
    const result = findBestCsp(chain, AMD_UNDERLYING_PRICE, { rules: DEFAULT_CSP_RULES, contracts: 1 });
    expect(result.candidate!.shortOccSymbol).toBe('B_NARROW_LOWOI');
    expect(result.candidate!.shortStrike).toBe(410);
    expect(result.qualified).toBe(true);
    expect(result.candidate!.cspOiWarning).toBe('OI 190 is below the preferred minimum of 500.');
    expect(result.disqualificationReason).toBeNull();
  });
});

describe('findBestCsp — CSP-0002 corrective pass IMPORTANT: canonical midpoint feeds every formula', () => {
  it('the candidate carries the exact mid used to compute credit/breakeven, and it matches the canonical (bid+ask)/2 when the supplied mid is out of range', () => {
    const exp = amdExpDate();
    const chain = {
      expirations: [exp],
      chains: {
        [exp]: [
          // Supplied mid (99.00) is nonsense -- well outside [bid, ask] --
          // and must be ignored in favor of the canonical midpoint.
          { strikePrice: 415, expirationDate: exp, optionType: 'P' as const, delta: -0.20, bid: 10.20, ask: 10.40, mid: 99.00, openInterest: 1000, occSymbol: 'STALE_MID' },
        ],
      },
    };
    const result = findBestCsp(chain, AMD_UNDERLYING_PRICE, { rules: DEFAULT_CSP_RULES, contracts: 1 });
    const c = result.candidate!;
    expect(c.cspMid).toBeCloseTo(10.30, 4); // (10.20 + 10.40) / 2, not the stale 99.00
    expect(c.credit).toBeCloseTo(parseFloat((10.30 * 100).toFixed(2)), 2);
    expect(c.breakeven).toBeCloseTo(parseFloat((415 - 10.30).toFixed(2)), 2);
  });
});
