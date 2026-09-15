import { describe, it, expect } from 'vitest';
import { findBestSpread } from '../spread-finder';
import { DEFAULT_ETF_RULES } from '../constants';

// TARGETED-FILTER-BADGE-INSTABILITY-0001 -- Dean reported a diagnostic BCS
// badge score changing (28 -> 40) for the identical underlying candidate
// between two views of the SAME scan session, with no rescan in between --
// only a post-scan Strategy filter toggle. Quinn's ask: prove or disprove
// whether the actual candidate search function is deterministic in
// isolation (same inputs, called twice, no React involved at all) before
// assuming a dependency-array fix is sufficient.
//
// Chain modeled loosely on Dean's real AAPL row: ~$329 underlying, 30 DTE,
// BCS strikes in the 290-320 range, ETF-tier rules (matches what a
// trend-aligned Targeted scan would apply for a widely-held name).

const EXP = '2026-10-16';
const PRICE = 329.58;

function makeCallLeg(strike: number, delta: number, bid: number, ask: number, oi: number) {
  return {
    expirationDate: EXP, optionType: 'C', strikePrice: strike, delta, iv: 0.28,
    bid, ask, mid: (bid + ask) / 2, openInterest: oi,
    occSymbol: `AAPL  261016C${String(strike * 1000).padStart(8, '0')}`,
  };
}

function buildRealisticChain() {
  // A spread of call strikes wide enough to exercise multiple width steps
  // and a real tiebreak decision, not just one trivially-best candidate.
  // Deltas kept within DEFAULT_ETF_RULES' SPREAD_DELTA_MIN/MAX (0.15-0.35)
  // for the short-leg candidates so at least one valid spread exists.
  return [
    makeCallLeg(295, 0.34, 6.10, 6.30, 9878),
    makeCallLeg(300, 0.28, 4.30, 4.50, 24353),
    makeCallLeg(305, 0.22, 2.90, 3.10, 10829),
    makeCallLeg(310, 0.18, 1.85, 2.05, 6820),
    makeCallLeg(315, 0.15, 1.10, 1.30, 4210),
    makeCallLeg(320, 0.11, 0.62, 0.82, 2650),
  ];
}

describe('findBestSpread determinism (Quinn: same inputs, called twice, no React)', () => {
  it('returns byte-identical results across two calls with the exact same chain array reference', () => {
    const chain = buildRealisticChain();
    const first = findBestSpread(chain, 'BCS', EXP, PRICE, DEFAULT_ETF_RULES);
    const second = findBestSpread(chain, 'BCS', EXP, PRICE, DEFAULT_ETF_RULES);
    expect(second).toEqual(first);
  });

  it('returns byte-identical results across two calls with a structurally-identical but separately-constructed chain', () => {
    // Guards against any hidden dependency on object/array identity rather
    // than value -- e.g. a cache keyed by reference that would silently
    // miss on a fresh (but equal) array.
    const first = findBestSpread(buildRealisticChain(), 'BCS', EXP, PRICE, DEFAULT_ETF_RULES);
    const second = findBestSpread(buildRealisticChain(), 'BCS', EXP, PRICE, DEFAULT_ETF_RULES);
    expect(second).toEqual(first);
  });

  it('is stable across ten repeated calls, not just two -- rules out low-frequency non-determinism', () => {
    const chain = buildRealisticChain();
    const results = Array.from({ length: 10 }, () =>
      findBestSpread(chain, 'BCS', EXP, PRICE, DEFAULT_ETF_RULES)
    );
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it('is unaffected by the chain array being pre-shuffled into a different order', () => {
    // If iteration order ever silently influenced the tiebreak, this
    // would catch it -- the correct candidate should not depend on which
    // order strikes appear in the raw chain.
    const chain = buildRealisticChain();
    const shuffled = [...chain].reverse();
    const original = findBestSpread(chain, 'BCS', EXP, PRICE, DEFAULT_ETF_RULES);
    const reordered = findBestSpread(shuffled, 'BCS', EXP, PRICE, DEFAULT_ETF_RULES);
    expect(reordered).toEqual(original);
  });

  it('produces a real, valid BCS candidate for this fixture (sanity check the test itself is exercising real logic)', () => {
    const chain = buildRealisticChain();
    const result = findBestSpread(chain, 'BCS', EXP, PRICE, DEFAULT_ETF_RULES);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('BCS');
  });
});
